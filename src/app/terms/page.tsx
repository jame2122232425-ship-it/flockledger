import type { Metadata } from "next";
import MarketingPage from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Terms of Service | FlockLedger",
  description: "Draft terms for using FlockLedger farm workspaces and services.",
};

export default function TermsPage() {
  return <MarketingPage page="terms" />;
}
