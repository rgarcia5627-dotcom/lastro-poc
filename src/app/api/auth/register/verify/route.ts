import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, isUniqueViolation } from "@/lib/db";
import { adminInvites, credentials, users } from "@/lib/db/schema";
import { HttpError, jsonRoute, readJson } from "@/lib/http";
import { hashInviteToken } from "@/lib/invites";
import { setSession, takeChallenge } from "@/lib/session";
import { relyingParty } from "@/lib/webauthn";

type RegistrationJSON = Parameters<typeof verifyRegistrationResponse>[0]["response"];

export const POST = jsonRoute(async (req) => {
  const challenge = await takeChallenge("register");
  if (!challenge) throw new HttpError(400, "O cadastro expirou. Comece novamente.");

  const body = await readJson(req);
  const response = body.response as RegistrationJSON | undefined;
  if (!response || typeof response !== "object") throw new HttpError(400, "Resposta da passkey ausente.");

  // A client without PRF could log in but never sign: stop here with a clear message.
  const prf = (response.clientExtensionResults as { prf?: { enabled?: boolean } } | undefined)?.prf;
  if (challenge.role === "client" && !challenge.org) throw new HttpError(400, "O cadastro expirou. Comece novamente.");
  if (challenge.role === "client" && prf?.enabled === false) {
    throw new HttpError(
      400,
      "Esta passkey não suporta a extensão PRF, necessária para a carteira. Use Chrome, Edge ou Safari atualizados com o Gerenciador de Senhas do Google ou o iCloud Keychain.",
    );
  }

  const rp = relyingParty();
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch {
    throw new HttpError(400, "Não foi possível validar a passkey.");
  }
  if (!verification.verified) throw new HttpError(400, "Não foi possível validar a passkey.");

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  try {
    await db().transaction(async (tx) => {
      if (challenge.role === "admin") {
        const used = await tx
          .update(adminInvites)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(adminInvites.tokenHash, hashInviteToken(challenge.inviteToken ?? "")),
              eq(adminInvites.email, challenge.email),
              isNull(adminInvites.usedAt),
              gt(adminInvites.expiresAt, new Date()),
            ),
          )
          .returning({ email: adminInvites.email });
        if (!used.length) throw new HttpError(400, "Convite inválido ou já utilizado.");
      }
      await tx.insert(users).values({
        id: challenge.userId,
        name: challenge.name,
        email: challenge.email,
        role: challenge.role,
        walletCredentialId: challenge.role === "client" ? credential.id : null,
        ...(challenge.role === "client" && challenge.org
          ? {
              orgName: challenge.org.name,
              orgTaxId: challenge.org.taxId,
              orgType: challenge.org.type,
              professionalDeclaredAt: new Date(),
            }
          : {}),
      });
      await tx.insert(credentials).values({
        id: credential.id,
        userId: challenge.userId,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "Este e-mail já tem cadastro. Use “Entrar”.");
    throw err;
  }

  await setSession({ id: challenge.userId, role: challenge.role });
  return Response.json({ ok: true, role: challenge.role, credentialId: credential.id, rpId: rp.rpID });
});
