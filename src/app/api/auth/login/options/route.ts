import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { jsonRoute } from "@/lib/http";
import { setChallenge } from "@/lib/session";
import { relyingParty } from "@/lib/webauthn";

export const POST = jsonRoute(async () => {
  // No allowCredentials: discoverable passkeys let the user pick their account.
  const options = await generateAuthenticationOptions({ rpID: relyingParty().rpID, userVerification: "required" });
  await setChallenge({ purpose: "login", challenge: options.challenge });
  return Response.json(options);
});
