"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/app-icon";

export type AppTab = "overview" | "batches" | "daily" | "health" | "revenue" | "audit" | "platform";

const primaryTabs = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "batches", label: "Batches", icon: "batch" },
  { id: "daily", label: "Daily", icon: "daily" },
  { id: "revenue", label: "Revenue", icon: "sales" },
] as const;

export function BottomTabs({
  tab,
  batchCount,
  canViewSales = true,
  onChange,
}: {
  tab: AppTab;
  batchCount: number;
  canViewSales?: boolean;
  onChange: (tab: AppTab) => void;
}) {
  return (
    <nav className="bottom-tabs" aria-label="Mobile navigation">
      {primaryTabs.filter((item) => item.id !== "revenue" || canViewSales).map((item) => {
        const active = tab === item.id;
        return (
          <button
            className={`bottom-tab ${active ? "active" : ""}`}
            type="button"
            key={item.id}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            onClick={() => onChange(item.id)}
          >
            <span className="bottom-tab-icon"><Icon name={item.icon} /></span>
            <span>{item.label}</span>
            {item.id === "batches" && batchCount > 0 && (
              <span className="nav-count" aria-label={`${batchCount} active batches`}>{batchCount}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function MobileAccountMenu({
  canViewTeam,
  isOwner,
  busy,
  extraLinks = [],
  onTeam,
  onSignOut,
}: {
  canViewTeam?: boolean;
  isOwner?: boolean;
  busy: boolean;
  extraLinks?: Array<{ label: string; onClick: () => void }>;
  onTeam: () => void;
  onSignOut: () => void;
}) {
  const canManageTeam = canViewTeam ?? isOwner ?? false;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  return (
    <div className="mobile-account-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        className="mobile-account-trigger"
        type="button"
        aria-label="Open account menu"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">☰</span>
      </button>
      {open && (
        <div className="mobile-account-popup" role="group" aria-label="Account actions">
          {extraLinks.map((link) => (
            <button type="button" key={link.label} onClick={() => { close(); link.onClick(); }}>
              {link.label}
            </button>
          ))}
          {canManageTeam && (
            <button type="button" onClick={() => { close(); onTeam(); }}>
              Manage team
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => { close(); onSignOut(); }}>
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

export function MobileNavMenu({ featuresHref = "#features" }: { featuresHref?: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const handleHashChange = () => close();
    window.addEventListener("hashchange", handleHashChange);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  const linkProps = { onClick: () => close() };

  return (
    <div className="landing-mobile-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        className="landing-menu-toggle"
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="landing-mobile-links"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">{open ? "×" : "☰"}</span>
      </button>
      {open && (
        <div className="landing-mobile-links" id="landing-mobile-links" role="group" aria-label="Mobile navigation">
          <Link href={featuresHref} {...linkProps}>Features</Link>
          <Link href="/guides" {...linkProps}>Guides</Link>
          <Link href="/faq" {...linkProps}>FAQ</Link>
          <Link href="/login" {...linkProps}>Log in</Link>
        </div>
      )}
    </div>
  );
}
