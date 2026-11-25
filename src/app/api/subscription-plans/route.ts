import { connection, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { subscriptionApiError } from "@/lib/subscriptions/api-errors";
import { getActiveSubscriptionPlans } from "@/lib/subscriptions/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
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
