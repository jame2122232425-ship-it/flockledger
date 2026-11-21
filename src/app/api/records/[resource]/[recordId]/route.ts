import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { editableResources } from "@/lib/api/editable-records";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ resource: string; recordId: string }> };
const resourceNames = Object.keys(editableResources) as [string, ...string[]];
const resourceSchema = z.enum(resourceNames);
const mutationSchema = z.object({
  farmId: z.string().uuid(),
  changes: z.record(z.string(), z.unknown()).optional(),
});

async function getTarget(context: RouteContext) {
  const params = await context.params;
  const resource = resourceSchema.safeParse(params.resource);
  const recordId = z.string().uuid().safeParse(params.recordId);
  if (!resource.success || !recordId.success) return null;
  return {
    definition: editableResources[resource.data],
    recordId: recordId.data,
  };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const target = await getTarget(context);
  if (!target) return apiError("Unknown record type or invalid record ID.", 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsedBody = mutationSchema.safeParse(body);
  if (!parsedBody.success || !parsedBody.data.changes || Object.keys(parsedBody.data.changes).length === 0) {
    return apiError("Provide a farmId and at least one valid field change.", 400);
  }

  const databaseChanges: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsedBody.data.changes)) {
    if (!Object.prototype.hasOwnProperty.call(target.definition.editableFields, key)) {
      return apiError(`Field '${key}' cannot be edited for this record type.`, 400);
    }
    const rule = target.definition.editableFields[key];
    const parsedValue = rule.schema.safeParse(value);
    if (!parsedValue.success) {
      return NextResponse.json(
        { error: `Invalid value for '${key}'.`, details: parsedValue.error.flatten() },
        { status: 400 },
      );
    }
    databaseChanges[rule.column] = parsedValue.data;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.from(target.definition.table)
      .update(databaseChanges)
      .eq("id", target.recordId)
      .eq("farm_id", parsedBody.data.farmId)
      .select(target.definition.fields)
      .maybeSingle();
    if (error) {
      if (error.code === "42501") return apiError("Only farm owners or managers can edit records.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      if (error.code === "23505") return apiError("The change conflicts with an existing record.", 409);
      if (error.code === "23503" || error.code === "23514" || error.code === "22P02") {
        return apiError("The change violates a record constraint.", 400);
      }
      console.error("Failed to edit record:", error.code);
      return apiError("Could not edit record.", 500);
    }
    if (!data) return apiError("Record not found or you do not have permission to edit it.", 404);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected record edit error:", error);
    return apiError("Could not edit record.", 500);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const target = await getTarget(context);
  if (!target) return apiError("Unknown record type or invalid record ID.", 404);
  if (target.definition.deletable === false) {
    return apiError("Batches cannot be deleted; preserve the batch record and its audit history.", 405);
  }
  const farmId = z.string().uuid().safeParse(request.nextUrl.searchParams.get("farmId"));
  if (!farmId.success) return apiError("Provide a valid farmId.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase.from(target.definition.table)
      .delete()
      .eq("id", target.recordId)
      .eq("farm_id", farmId.data)
      .select("id")
      .maybeSingle();
    if (error) {
      if (error.code === "42501") return apiError("Only farm owners or managers can delete records.", 403);
      if (error.code === "P0001") return apiError(error.message, 409);
      if (error.code === "23503") return apiError("The record is still referenced by other data.", 409);
      console.error("Failed to delete record:", error.code);
      return apiError("Could not delete record.", 500);
    }
    if (!data) return apiError("Record not found or you do not have permission to delete it.", 404);
    return NextResponse.json({ data: { id: data.id, deleted: true } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected record deletion error:", error);
    return apiError("Could not delete record.", 500);
  }
}
