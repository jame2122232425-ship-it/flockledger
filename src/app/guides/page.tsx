import type { Metadata } from "next";
import MarketingPage from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Farm Guides | FlockLedger",
  description: "Practical guides to farm setup, poultry batches, daily records, flock health, and sales.",
};

export default function GuidesPage() {
  return <MarketingPage page="guides" />;
}
