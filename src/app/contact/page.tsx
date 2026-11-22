import type { Metadata } from "next";
import MarketingPage from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Contact | FlockLedger",
  description: "Contact the FlockLedger team for help with farm setup, account access, and product questions.",
};

export default function ContactPage() {
  return <MarketingPage page="contact" />;
}
