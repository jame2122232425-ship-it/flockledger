import type { Metadata } from "next";
import MarketingPage from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "About | FlockLedger",
  description: "Learn how FlockLedger helps poultry farms keep flock, health, stock, and financial records together.",
};

export default function AboutPage() {
  return <MarketingPage page="about" />;
}
