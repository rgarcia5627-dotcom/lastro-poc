import type { ReactNode } from "react";
import { AppShell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const links = [
  { href: "/admin", label: "Visão geral", exact: true },
  { href: "/admin/ativos", label: "Ativos" },
  { href: "/admin/propostas", label: "Propostas" },
  { href: "/admin/instituicoes", label: "Instituições" },
  { href: "/admin/transferencias", label: "Transferências" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAdmin();
  const network = env().STELLAR_NETWORK;
  return (
    <AppShell links={links} userName={user.name} home="/admin" badge={network === "testnet" ? "Admin · testnet" : "Admin"}>
      {children}
    </AppShell>
  );
}
