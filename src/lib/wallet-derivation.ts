/**
 * Passkey → Stellar key derivation (isomorphic: browser + Node ≥ 20).
 *
 * The WebAuthn PRF extension returns a 32-byte secret that only this passkey can
 * produce for this site and salt. We expand it with HKDF-SHA256 into an ed25519 seed.
 * The seed never leaves the browser and is never stored — every signature re-asks the
 * passkey. Same passkey ⇒ same Stellar account, on any device the passkey syncs to.
 */

/** Salt sent to the authenticator's PRF. Changing it changes every wallet — never edit. */
export const PRF_SALT_LABEL = "lastro:stellar-wallet:v1";
const HKDF_SALT = "lastro:hkdf:v1";
const HKDF_INFO = "stellar-ed25519-seed";

export function prfSalt(): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(PRF_SALT_LABEL);
}

export async function deriveWalletSeed(prfOutput: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  if (prfOutput.byteLength !== 32) throw new Error("A saída PRF deve ter 32 bytes.");
  const key = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(HKDF_SALT),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}
