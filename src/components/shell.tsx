import Link from "next/link";
import type { ReactNode } from "react";
import { NavLinks } from "./nav";

export function Wordmark({ dark = false, href = "/" }: { dark?: boolean; href?: string }) {
  return (
    <Link href={href} className={dark ? "text-white" : "text-ink"}>
      <span className="text-xl font-light tracking-tight">Lastro</span>
    </Link>
  );
}

export function AppShell({
  links,
  userName,
  badge,
  home,
  children,
}: {
  links: { href: string; label: string; exact?: boolean }[];
  userName: string;
  badge?: string;
  home: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="bg-ink">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Wordmark dark href={home} />
            {badge && <span className="rounded bg-brand/20 px-1.5 py-0.5 text-[11px] font-medium text-brand">{badge}</span>}
          </div>
          <NavLinks links={links} />
          <div className="ml-auto flex items-center gap-3 text-sm text-white/70">
            <span className="hidden sm:inline">{userName}</span>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="rounded-md px-2 py-1 text-white/70 hover:text-white">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
