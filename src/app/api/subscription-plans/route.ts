import { connection, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { subscriptionApiError } from "@/lib/subscriptions/api-errors";
import { SUBSCRIPTIONS_ENABLED } from "@/lib/subscriptions/config";
import { getActiveSubscriptionPlans } from "@/lib/subscriptions/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  if (!SUBSCRIPTIONS_ENABLED) {
    return apiError("Subscriptions are currently unavailable.", 410);
  }
  await connection();
  try {
    const supabase = createSupabaseAdminClient();
    const data = await getActiveSubscriptionPlans(supabase);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Staff provisioning is not configured")) {
      return apiError("Subscription plan catalog is temporarily unavailable.", 503);
    }
    return subscriptionApiError(error, "Could not load subscription plans.");
  }
}
