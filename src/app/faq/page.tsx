import type { Metadata } from "next";
import MarketingPage from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Frequently Asked Questions | FlockLedger",
  description: "Answers about FlockLedger accounts, farm roles, records, and data access.",
};

export default function FaqPage() {
  return <MarketingPage page="faq" />;
}
