import type { Metadata } from "next";
import MarketingPage from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Farm Notes | FlockLedger",
  description: "Ideas and practical advice for poultry record keeping and farm operations.",
};

export default function BlogPage() {
  return <MarketingPage page="blog" />;
}
