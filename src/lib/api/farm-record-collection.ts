import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CollectionOptions<Schema extends z.ZodType> = {
  table: string;
  fields: string;
  orderBy: string;
  supportsBatchFilter?: boolean;
  createSchema: Schema;
  toDatabaseRecord: (value: z.infer<Schema>) => Record<string, unknown>;
};

export function createFarmRecordCollection<Schema extends z.ZodType>(
  options: CollectionOptions<Schema>,
) {
  async function GET(request: NextRequest) {
    const parsed = z.object({
      farmId: z.string().uuid(),
      batchId: z.string().uuid().optional(),
    }).safeParse({
      farmId: request.nextUrl.searchParams.get("farmId"),
      batchId: request.nextUrl.searchParams.get("batchId") ?? undefined,
    });
    if (!parsed.success) return apiError("Provide a valid farmId and optional batchId.", 400);

    try {
      const supabase = await createSupabaseServerClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) return apiError("Authentication required.", 401);

      let query = supabase.from(options.table).select(options.fields)
        .eq("farm_id", parsed.data.farmId).order(options.orderBy, { ascending: false });
      if (options.supportsBatchFilter && parsed.data.batchId) {
        query = query.eq("batch_id", parsed.data.batchId);
      }

      const { data, error } = await query;
      if (error) {
        console.error(`Failed to load ${options.table}:`, error.code);
        return apiError("Could not load records.", 500);
      }
      return NextResponse.json({ data });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
        return apiError(error.message, 503);
      }
      console.error(`Unexpected ${options.table} list error:`, error);
      return apiError("Could not load records.", 500);
    }
  }

  async function POST(request: NextRequest) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError("Request body must be valid JSON.", 400);
    }

    const parsed = options.createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid record.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    try {
      const supabase = await createSupabaseServerClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) return apiError("Authentication required.", 401);

      const { data, error } = await supabase.from(options.table)
        .insert(options.toDatabaseRecord(parsed.data))
        .select(options.fields)
        .single();
      if (error) {
        if (error.code === "42501") return apiError("You cannot add records for this farm.", 403);
        if (error.code === "23505") return apiError("A matching record already exists.", 409);
        if (error.code === "P0001") return apiError(error.message, 409);
        console.error(`Failed to create ${options.table} record:`, error.code);
        return apiError("Could not create record.", 500);
      }
      return NextResponse.json({ data }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
        return apiError(error.message, 503);
      }
      console.error(`Unexpected ${options.table} creation error:`, error);
      return apiError("Could not create record.", 500);
    }
  }

  return { GET, POST };
}
