import type { Metadata } from "next";
import MarketingPage from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Privacy Policy | FlockLedger",
  description: "Draft privacy policy for FlockLedger accounts and farm records.",
};

export default function PrivacyPage() {
  return <MarketingPage page="privacy" />;
}
