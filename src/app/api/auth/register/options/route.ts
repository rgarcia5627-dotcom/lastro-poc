import { randomUUID } from "node:crypto";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { findValidInvite } from "@/lib/invites";
import { db } from "@/lib/db";
import { type Role, users } from "@/lib/db/schema";
import { HttpError, jsonRoute, readJson } from "@/lib/http";
import { setChallenge } from "@/lib/session";
import { firstIssue } from "@/lib/validation";
import { relyingParty } from "@/lib/webauthn";

const ORG_TYPES = ["gestora", "fundo", "family_office", "plataforma", "banco", "seguradora_previdencia", "nao_residente"] as const;

const orgSchema = z.object({
  name: z.string().trim().min(2, "Informe a razão social da instituição").max(160),
  taxId: z.string().trim().min(5, "Informe o CNPJ ou o registro no exterior").max(40),
  type: z.enum(ORG_TYPES, { message: "Escolha o tipo de instituição" }),
  professional: z.literal(true, { message: "A Lastro atende apenas investidores profissionais: confirme a declaração." }),
});

const bodySchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(200),
  inviteToken: z.string().min(10).max(200).optional(),
  org: orgSchema.optional(),
});

export const POST = jsonRoute(async (req) => {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error));
  const { name, email, inviteToken, org } = parsed.data;

  let role: Role = "client";
  if (inviteToken) {
    const invite = await findValidInvite(inviteToken);
    if (!invite || invite.email !== email) throw new HttpError(400, "Convite inválido ou expirado.");
    role = "admin";
  } else if (!org) {
    // Investors are institutions only: no account without the institution and the professional-investor declaration.
    throw new HttpError(400, "Informe os dados da instituição.");
  }

  const [existing] = await db().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new HttpError(409, "Este e-mail já tem cadastro. Use “Entrar”.");

  const rp = relyingParty();
  const userId = randomUUID();
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: email,
    userDisplayName: name,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    // Ask the authenticator to enable PRF — the client's Stellar key is derived from it.
    extensions: { prf: {} } as Parameters<typeof generateRegistrationOptions>[0]["extensions"],
  });

  await setChallenge({
    purpose: "register",
    challenge: options.challenge,
    userId,
    name,
    email,
    role,
    inviteToken,
    org: role === "client" && org ? { name: org.name, taxId: org.taxId, type: org.type } : undefined,
  });
  return Response.json(options);
});
