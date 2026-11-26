/* @vitest-environment jsdom */

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomTabs, MobileAccountMenu, MobileNavMenu } from "../src/components/mobile-navigation";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    onClick?: () => void;
  }) => <a href={href} {...props}>{children}</a>,
}));

afterEach(cleanup);

describe("mobile navigation", () => {
  it("opens and closes the public menu, including the sign-in link", () => {
    render(<MobileNavMenu />);
    const toggle = screen.getByRole("button", { name: "Open menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "Mobile navigation" })).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Close menu" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Features" }).getAttribute("href")).toBe("#features");
    expect(screen.getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/pricing");
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Mobile navigation" })).toBeNull();
  });

  it("marks the active bottom tab and reports tab changes", () => {
    const onChange = vi.fn();
    render(<BottomTabs tab="daily" batchCount={2} onChange={onChange} />);

    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Daily" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Batches" }));
    expect(onChange).toHaveBeenCalledWith("batches");
  });

  it("shows owner and extra workspace actions in the account menu", () => {
    const onTeam = vi.fn();
    const onSignOut = vi.fn();
    const onBilling = vi.fn();
    render(
      <MobileAccountMenu
        isOwner
        busy={false}
        extraLinks={[{ label: "Billing", onClick: onBilling }]}
        onTeam={onTeam}
        onSignOut={onSignOut}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Billing" }));

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage team" }));

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onBilling).toHaveBeenCalledOnce();
    expect(onTeam).toHaveBeenCalledOnce();
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("hides team management from non-owners", () => {
    render(
      <MobileAccountMenu isOwner={false} busy={false} onTeam={vi.fn()} onSignOut={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    expect(screen.queryByRole("button", { name: "Manage team" })).toBeNull();
  });
});
