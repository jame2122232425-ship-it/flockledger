import { apiError } from "@/lib/api";
import { SubscriptionServiceError } from "@/lib/subscriptions/service";

export function subscriptionApiError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.startsWith("Supabase is not configured")) {
    return apiError(error.message, 503);
  }
  if (error instanceof SubscriptionServiceError) {
    if (error.code === "42501") return apiError("You are not authorized for this farm subscription.", 403);
    if (error.code === "P0001") return apiError(error.message, 409);
    if (error.code === "P0002") return apiError("Farm or subscription not found.", 404);
    if (error.code === "22023") return apiError("Invalid subscription operation.", 400);
    console.error("Subscription operation failed:", error.code);
    return apiError(fallback, 500);
  }
  console.error("Unexpected subscription operation error:", error);
  return apiError(fallback, 500);
}
