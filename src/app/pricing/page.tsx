import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MarketingPage from "@/components/marketing-pages";
import { SUBSCRIPTIONS_ENABLED } from "@/lib/subscriptions/config";

export const metadata: Metadata = {
  title: "Pricing | FlockLedger",
  description: "Compare Starter, Professional, and Enterprise plans for FlockLedger poultry farm management.",
};

export default function PricingPage() {
  if (!SUBSCRIPTIONS_ENABLED) redirect("/");
  return <MarketingPage page="pricing" />;
}
