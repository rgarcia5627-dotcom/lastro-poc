"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptAllocation, createWallet, errorMessage } from "@/lib/client/passkey-wallet";
import { Button } from "./ui";

export function CreateWalletButton({ credentialId, rpId }: { credentialId: string; rpId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await createWallet(credentialId, rpId);
      router.replace("/app");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={run} disabled={busy}>
        {busy ? "Confirme com a passkey…" : "Criar minha carteira"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function AcceptAllocationButton(props: {
  allocationId: string;
  credentialId: string;
  rpId: string;
  walletAddress: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await acceptAllocation(props);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button onClick={run} disabled={busy} size="sm">
        {busy ? "Confirme com a passkey…" : "Aceitar"}
      </Button>
      {error && (
        <p role="alert" className="max-w-xs text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-brand-strong hover:underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard unavailable; ignore
        }
      }}
    >
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}
