import { NextRequest, NextResponse } from "next/server";
import { apiError, isUuid } from "@/lib/api";
import { subscriptionApiError } from "@/lib/subscriptions/api-errors";
import { requestSubscriptionCancellation } from "@/lib/subscriptions/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ farmId: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  const { farmId } = await context.params;
  if (!isUuid(farmId)) return apiError("Invalid farm ID.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return apiError("Authentication required.", 401);

    const data = await requestSubscriptionCancellation(supabase, farmId);
    return NextResponse.json({ data });
  } catch (error) {
    return subscriptionApiError(error, "Could not schedule subscription cancellation.");
  }
}
