import type { ReactNode } from "react";

export type IconName = "overview" | "batch" | "daily" | "bird" | "feed" | "cash" | "sales";

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
    batch: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" /><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5" /></>,
    daily: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" /></>,
    bird: <><path d="M7 14c-2.2 0-4-1.6-4-3.5S4.8 7 7 7c1.7 0 3.2.9 3.8 2.2 2.1-.6 4.2-.2 5.7 1.2l3.5-.2-1.7 2.1c.1 3.3-2.7 5.7-6.2 5.7H9l-3 2v-3.2A5.2 5.2 0 0 1 4 14.5" /><circle cx="7" cy="10" r=".7" fill="currentColor" stroke="none" /></>,
    feed: <><path d="M4 7h16l-1.5 13h-13zM7 7l1-4h8l1 4M8 11h8" /></>,
    cash: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h.01M17 15h.01M12 9v6M10 11h3.5a1.5 1.5 0 0 1 0 3H10" /></>,
    sales: <><path d="M4 19V5M4 19h17M8 15l4-4 3 2 5-6" /><path d="M16 7h4v4" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
