import FlockLedgerApp from "@/components/flockledger-app";

export const instant = false;

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const initialAuthError = error === "invalid-link"
    ? "That reset link is invalid or expired. Request a new one."
    : error === "unavailable"
      ? "Password recovery is temporarily unavailable. Please try again later."
      : "";

  return <FlockLedgerApp initialAuthMode="forgot-password" initialAuthError={initialAuthError} />;
}
