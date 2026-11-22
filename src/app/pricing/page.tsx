import type { Metadata } from "next";
import MarketingPage from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Pricing | FlockLedger",
  description: "Compare Starter, Professional, and Enterprise plans for FlockLedger poultry farm management.",
};

export default function PricingPage() {
  return <MarketingPage page="pricing" />;
}
