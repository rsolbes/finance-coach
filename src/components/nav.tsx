"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/coach", label: "Coach", icon: "M4 5h16v11H8l-4 4V5z" },
  { href: "/spending", label: "Spending", icon: "M4 19V9m6 10V5m6 14v-7m4 7H2" },
  { href: "/plan", label: "Plan", icon: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <>
      <header className="sticky top-0 z-20 hidden border-b border-border bg-bg/90 backdrop-blur sm:block">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <span className="font-semibold tracking-tight">Finance Coach</span>
          <nav className="flex gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  active(l.href) ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-text"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-border bg-surface/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${
              active(l.href) ? "font-semibold text-accent" : "text-muted"
            }`}
          >
            <Icon d={l.icon} />
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
