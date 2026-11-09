import type { ReactNode } from "react";
import { AppShell } from "@/components/shell";
import { requireClient } from "@/lib/auth";

export const dynamic = "force-dynamic";

const links = [
  { href: "/app", label: "Carteira", exact: true },
  { href: "/app/propostas", label: "Propostas" },
  { href: "/app/pagamentos", label: "Pagamentos" },
];

export default async function ClientLayout({ children }: { children: ReactNode }) {
  const user = await requireClient();
  return (
    <AppShell links={links} userName={user.orgName ? `${user.name} · ${user.orgName}` : user.name} home="/app">
      {children}
    </AppShell>
  );
}
