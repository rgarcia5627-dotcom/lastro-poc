"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function NavLinks({ links }: { links: { href: string; label: string; exact?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Principal">
      {links.map((link) => {
        const active = link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              active ? "bg-white/10 text-white" : "text-white/65 hover:text-white",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
