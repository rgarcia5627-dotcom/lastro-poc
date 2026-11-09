import "./buffer-polyfill";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { deriveWalletSeed, prfSalt } from "@/lib/wallet-derivation";

export class PasskeyWalletError extends Error {}

function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Asks the passkey to evaluate PRF and derives the client's Stellar keypair.
 * Throws PasskeyWalletError with a user-facing message when PRF is unavailable.
 */
export async function unlockWallet(credentialId: string, rpId: string): Promise<Keypair> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    throw new PasskeyWalletError("Este navegador não suporta passkeys.");
  }
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId,
        allowCredentials: [{ type: "public-key", id: base64urlToBytes(credentialId) }],
        userVerification: "required",
        timeout: 120_000,
        extensions: { prf: { eval: { first: prfSalt() } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    if ((err as DOMException)?.name === "NotAllowedError") {
      throw new PasskeyWalletError("Confirmação com a passkey cancelada ou expirada.");
    }
    throw new PasskeyWalletError("Não foi possível usar a passkey neste dispositivo.");
  }
  if (!credential) throw new PasskeyWalletError("Nenhuma passkey selecionada.");

  const ext = credential.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer | ArrayBufferView } } };
  const first = ext.prf?.results?.first;
  if (!first) {
    throw new PasskeyWalletError(
      "Sua passkey não suporta a extensão PRF, necessária para a carteira. Use Chrome, Edge ou Safari atualizados com o Gerenciador de Senhas do Google ou o iCloud Keychain.",
    );
  }
  const buffer =
    first instanceof ArrayBuffer
      ? first
      : (first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength) as ArrayBuffer);
  const seed = await deriveWalletSeed(buffer);
  return Keypair.fromRawEd25519Seed(Buffer.from(seed));
}

export function signXdr(xdr: string, networkPassphrase: string, keypair: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  tx.sign(keypair);
  return tx.toXDR();
}

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  return data as T;
}

type BuildResponse = { done: true } | { done?: false; xdr: string; networkPassphrase: string };

/** Derives the wallet from the passkey and creates the (sponsored) Stellar account. */
export async function createWallet(credentialId: string, rpId: string): Promise<string> {
  const keypair = await unlockWallet(credentialId, rpId);
  const build = await postJSON<BuildResponse>("/api/wallet/build", { publicKey: keypair.publicKey() });
  if (build.done) return keypair.publicKey();
  await postJSON("/api/wallet/submit", { xdr: signXdr(build.xdr, build.networkPassphrase, keypair) });
  return keypair.publicKey();
}

/** Accepts an allocation by opening the trustline, signed with the passkey wallet. */
export async function acceptAllocation(opts: {
  allocationId: string;
  credentialId: string;
  rpId: string;
  walletAddress: string;
}): Promise<void> {
  const keypair = await unlockWallet(opts.credentialId, opts.rpId);
  if (keypair.publicKey() !== opts.walletAddress) {
    throw new PasskeyWalletError("Esta passkey não corresponde à sua carteira Lastro.");
  }
  const base = `/api/allocations/${opts.allocationId}/accept`;
  const build = await postJSON<BuildResponse>(`${base}/build`, {});
  if (build.done) return;
  await postJSON(`${base}/submit`, { xdr: signXdr(build.xdr, build.networkPassphrase, keypair) });
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Algo deu errado. Tente novamente.";
}
