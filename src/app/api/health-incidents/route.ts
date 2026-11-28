import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, isUuid } from "@/lib/api";
import { parsePagination, paginationMetadata, paginationRange } from "@/lib/api/pagination";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const incidentSchema = z.object({
  farmId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  incidentDate: z.iso.date(),
  summary: z.string().trim().min(1).max(255),
  observedSigns: z.string().trim().min(1).max(4000),
  birdsAffected: z.number().int().min(0),
  immediateActions: z.string().trim().max(4000).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  const farmId = request.nextUrl.searchParams.get("farmId");
  if (!pagination) return apiError("Provide valid page and pageSize values (1-100).", 400);
  if (!farmId || !isUuid(farmId)) return apiError("Provide a valid farm ID.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { from, to } = paginationRange(pagination);
    const { data, error, count } = await supabase
      .from("health_incidents")
      .select("id, farm_id, batch_id, incident_date, summary, observed_signs, birds_affected, immediate_actions, reported_by, created_at", { count: "exact" })
      .eq("farm_id", farmId)
      .order("incident_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) {
      if (error.code === "42501") return apiError("Health records access is restricted.", 403);
      console.error("Failed to load health incidents:", error.code);
      return apiError("Could not load health incidents.", 500);
    }

    return NextResponse.json({
      data,
      pagination: paginationMetadata(count ?? 0, pagination),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected health incident list error:", error);
    return apiError("Could not load health incidents.", 500);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const parsed = incidentSchema.safeParse(body);
  if (!parsed.success) return apiError("Provide valid health incident details.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const { data, error } = await supabase
      .from("health_incidents")
      .insert({
        farm_id: parsed.data.farmId,
        batch_id: parsed.data.batchId ?? null,
        incident_date: parsed.data.incidentDate,
        summary: parsed.data.summary,
        observed_signs: parsed.data.observedSigns,
        birds_affected: parsed.data.birdsAffected,
        immediate_actions: parsed.data.immediateActions ?? null,
        reported_by: user.id,
      })
      .select("id, farm_id, batch_id, incident_date, summary, observed_signs, birds_affected, immediate_actions, reported_by, created_at")
      .single();
    if (error) {
      if (error.code === "42501") return apiError("Health incident reporting permission required.", 403);
      if (error.code === "23503" || error.code === "23514") return apiError("The incident does not match this farm or batch.", 400);
      console.error("Failed to report health incident:", error.code);
      return apiError("Could not report health incident.", 500);
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
      return apiError(error.message, 503);
    }
    console.error("Unexpected health incident creation error:", error);
    return apiError("Could not report health incident.", 500);
  }
}
