import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { credentials, users } from "@/lib/db/schema";
import { HttpError, jsonRoute, readJson } from "@/lib/http";
import { setSession, takeChallenge } from "@/lib/session";
import { relyingParty } from "@/lib/webauthn";

type AuthenticationJSON = Parameters<typeof verifyAuthenticationResponse>[0]["response"];
type Transport = NonNullable<Parameters<typeof verifyAuthenticationResponse>[0]["credential"]["transports"]>[number];

export const POST = jsonRoute(async (req) => {
  const challenge = await takeChallenge("login");
  if (!challenge) throw new HttpError(400, "O login expirou. Tente novamente.");

  const body = await readJson(req);
  const response = body.response as AuthenticationJSON | undefined;
  if (!response || typeof response.id !== "string") throw new HttpError(400, "Resposta da passkey ausente.");

  const [credential] = await db().select().from(credentials).where(eq(credentials.id, response.id)).limit(1);
  if (!credential) throw new HttpError(400, "Passkey não reconhecida. Você já tem cadastro?");

  const rp = relyingParty();
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: credential.id,
        publicKey: isoBase64URL.toBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports as Transport[],
      },
      requireUserVerification: true,
    });
  } catch {
    throw new HttpError(400, "Não foi possível validar a passkey.");
  }
  if (!verification.verified) throw new HttpError(400, "Não foi possível validar a passkey.");

  await db()
    .update(credentials)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(credentials.id, credential.id));

  const [user] = await db().select().from(users).where(eq(users.id, credential.userId)).limit(1);
  if (!user) throw new HttpError(400, "Conta não encontrada.");

  await setSession({ id: user.id, role: user.role });
  return Response.json({ ok: true, role: user.role });
});
