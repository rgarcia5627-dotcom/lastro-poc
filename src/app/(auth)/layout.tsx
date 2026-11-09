import type { ReactNode } from "react";
import { Wordmark } from "@/components/shell";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Wordmark />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6">{children}</div>
      <p className="mt-6 max-w-sm text-center text-xs text-muted">
        Crédito privado brasileiro estruturado com instituições e emitido na rede Stellar. A carteira é protegida pela sua passkey.
      </p>
    </div>
  );
}
