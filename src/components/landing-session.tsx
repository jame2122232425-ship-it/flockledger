"use client";

import { createContext, ReactNode, useContext, useEffect, useState } from "react";

type LandingSession = {
  authenticated: boolean;
  accountName: string;
};

const LandingSessionContext = createContext<LandingSession>({
  authenticated: false,
  accountName: "",
});

export function LandingSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LandingSession>({
    authenticated: false,
    accountName: "",
  });

  useEffect(() => {
    let active = true;

    fetch("/api/auth/session", { credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not check your session.");
        }
        if (active) setSession(payload.data);
      })
      .catch((error: unknown) => {
        console.error("Could not check landing page session:", error);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <LandingSessionContext.Provider value={session}>
      {children}
    </LandingSessionContext.Provider>
  );
}

export function LandingNavActions() {
  const { authenticated, accountName } = useContext(LandingSessionContext);

  return authenticated ? (
    <>
      {accountName && <span className="landing-account">{accountName}</span>}
      <a className="landing-button landing-button-amber" href="/app">Open dashboard</a>
    </>
  ) : (
    <>
      <a className="landing-login" href="/login">Log in</a>
      <a className="landing-button landing-button-amber" href="/signup">Create Account</a>
    </>
  );
}

export function LandingHeroActions() {
  const { authenticated } = useContext(LandingSessionContext);

  return authenticated ? (
    <>
      <a className="landing-button landing-button-amber landing-button-large" href="/app">
        Open dashboard
      </a>
      <a className="landing-demo-link" href="/app?tab=revenue">
        <span aria-hidden="true">→</span> View revenue
      </a>
    </>
  ) : (
    <>
      <a className="landing-button landing-button-amber landing-button-large" href="/signup">
        Create Your Free Farm Account
      </a>
      <a className="landing-demo-link" href="#how-it-works">
        <span aria-hidden="true">▶</span> See How It Works
      </a>
    </>
  );
}

export function LandingHeroFootnote() {
  const { authenticated } = useContext(LandingSessionContext);
  return (
    <p className="landing-no-card">
      {authenticated
        ? "Signed in — your latest farm records are ready."
        : "No credit card required"}
    </p>
  );
}

export function LandingCta() {
  const { authenticated } = useContext(LandingSessionContext);

  return (
    <div className="landing-container landing-cta-inner">
      <div>
        <p>{authenticated ? "Welcome back." : "Your birds are growing."}</p>
        <h2>{authenticated ? "Continue where you left off." : "Your records should be too."}</h2>
      </div>
      <a
        className="landing-button landing-button-amber landing-button-large"
        href={authenticated ? "/app" : "/signup"}
      >
        {authenticated ? "Go to Dashboard" : "Start Your First Batch Today"}
      </a>
    </div>
  );
}
