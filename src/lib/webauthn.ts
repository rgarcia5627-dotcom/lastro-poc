import { env } from "@/lib/env";

export function relyingParty() {
  const e = env();
  return { rpID: e.WEBAUTHN_RP_ID, rpName: e.WEBAUTHN_RP_NAME, origin: new URL(e.APP_ORIGIN).origin };
}
