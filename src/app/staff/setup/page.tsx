"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function StaffSetupContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tokenHash = searchParams.get("token_hash") ?? "";
  const changePassword = searchParams.get("change_password") === "1";
  const [status, setStatus] = useState<"verifying" | "ready" | "error" | "complete">(
    changePassword ? "ready" : tokenHash ? "ready" : "error",
  );
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [message, setMessage] = useState(
    changePassword
      ? "Enter a new password to finish setting up your account."
      : tokenHash
        ? "Enter your temporary password, then choose a new password."
        : "This setup link is missing its secure token.",
  );
  const [busy, setBusy] = useState(false);

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password !== confirmation) {
      setStatus("ready");
      setMessage("Passwords do not match.");
      setBusy(false);
      return;
    }
    try {
      if (tokenHash) {
        const verifyResponse = await fetch("/api/staff/setup/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenHash, password: temporaryPassword }),
        });
        const verifyPayload = await verifyResponse.json();
        if (!verifyResponse.ok) throw new Error(verifyPayload.error ?? "Could not verify setup link.");
      }
      const response = await fetch("/api/staff/setup/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not change password.");
      setStatus("complete");
      setMessage("Password changed successfully.");
      window.setTimeout(() => router.replace("/app"), 900);
    } catch (error) {
      setStatus("ready");
      setMessage(error instanceof Error ? error.message : "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="staff-setup-page">
      <section className="staff-setup-card" aria-live="polite">
        <span className="staff-setup-mark" aria-hidden="true">FL</span>
        <p className="staff-setup-kicker">FlockLedger staff setup</p>
        <h1>
          {status === "verifying" && "Setting up your account"}
          {status === "ready" && "Create your new password"}
          {status === "complete" && "You’re ready"}
          {status === "error" && "Setup unavailable"}
        </h1>
        {message && <p className={status === "error" ? "staff-setup-error" : "staff-setup-copy"}>{message}</p>}
        {status === "ready" && (
          <form className="form-stack" onSubmit={handlePasswordChange}>
            {tokenHash && (
              <label>
                Temporary password
                <input
                  type="password"
                  autoComplete="current-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={temporaryPassword}
                  onChange={(event) => setTemporaryPassword(event.target.value)}
                />
              </label>
            )}
            <label>
              New password
              <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
            </label>
            <label>
              Confirm password
              <input name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
            </label>
            <button className="button button-primary button-wide" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Set password and continue"}
            </button>
          </form>
        )}
        {status === "error" && (
          <a className="button button-quiet button-wide" href="/login">Return to sign in</a>
        )}
      </section>
    </main>
  );
}

export default function StaffSetupPage() {
  return (
    <Suspense fallback={<main className="staff-setup-page"><section className="staff-setup-card">Loading staff setup…</section></main>}>
      <StaffSetupContent />
    </Suspense>
  );
}
