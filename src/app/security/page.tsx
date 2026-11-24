import type { Metadata } from "next";
import MarketingPage from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Data Security | FlockLedger",
  description: "Draft overview of FlockLedger access controls and security practices.",
};

export default function SecurityPage() {
  return <MarketingPage page="security" />;
}
