"use client";

import { useState } from "react";
import { Button } from "./ui";

export type VerifyLabels = {
  verify: string;
  running: string;
  memo: string;
  dataEntry: string;
  matches: string;
  differs: string;
  failed: string;
  computed: string;
};

type Check = { label: string; ok: boolean };
type State = { status: "idle" | "running" } | { status: "done"; hash: string; checks: Check[] } | { status: "error" };

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  [...(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const base64ToHex = (b64: string | undefined) => (b64 ? hex(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))) : "");

/**
 * Checks a payment record in the visitor's own browser, without trusting Lastro's server:
 * SHA-256 of the downloaded record vs the registry transaction's memo (read from Horizon),
 * and, for the latest payment, vs the issuer's `lastro:pay:<CODE>` data entry.
 */
export function VerifyRecord({
  recordUrl,
  txHash,
  horizonUrl,
  issuer,
  dataKey,
  checkDataEntry,
  labels,
}: {
  recordUrl: string;
  txHash: string;
  horizonUrl: string;
  issuer: string;
  dataKey: string;
  checkDataEntry: boolean;
  labels: VerifyLabels;
}) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function verify() {
    setState({ status: "running" });
    try {
      const body = await (await fetch(recordUrl, { cache: "no-store" })).text();
      const hash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
      const tx = (await (await fetch(`${horizonUrl}/transactions/${txHash}`)).json()) as {
        successful?: boolean;
        memo_type?: string;
        memo?: string;
      };
      const checks: Check[] = [{ label: labels.memo, ok: Boolean(tx.successful) && tx.memo_type === "hash" && base64ToHex(tx.memo) === hash }];
      if (checkDataEntry) {
        const account = (await (await fetch(`${horizonUrl}/accounts/${issuer}`)).json()) as { data?: Record<string, string> };
        checks.push({ label: labels.dataEntry, ok: base64ToHex(account.data?.[dataKey]) === hash });
      }
      setState({ status: "done", hash, checks });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <div className="space-y-1.5" aria-live="polite">
      {state.status !== "done" && (
        <Button type="button" variant="secondary" size="sm" onClick={verify} disabled={state.status === "running"}>
          {state.status === "running" ? labels.running : labels.verify}
        </Button>
      )}
      {state.status === "error" && <p className="text-xs text-danger">{labels.failed}</p>}
      {state.status === "done" && (
        <div className="text-xs">
          <ul className="space-y-0.5">
            {state.checks.map((c) => (
              <li key={c.label} className={c.ok ? "text-ok" : "text-danger"}>
                {c.ok ? "✓" : "✗"} {c.label}: {c.ok ? labels.matches : labels.differs}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-muted">
            {labels.computed} <span className="font-mono break-all">{state.hash}</span>
          </div>
        </div>
      )}
    </div>
  );
}
