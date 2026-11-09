import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import type { OrgType, Role } from "@/lib/db/schema";
import { env } from "@/lib/env";

const SESSION_COOKIE = "lastro_session";
const CHALLENGE_COOKIE = "lastro_webauthn";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const CHALLENGE_TTL_SECONDS = 5 * 60;

const key = () => new TextEncoder().encode(env().SESSION_SECRET);
const secure = () => env().APP_ORIGIN.startsWith("https://");

export async function setSession(user: { id: string; role: Role }) {
  const token = await new SignJWT({ role: user.role, typ: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function readSession(): Promise<{ userId: string } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.typ !== "session" || typeof payload.sub !== "string") return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export type ChallengeData =
  | {
      purpose: "register";
      challenge: string;
      userId: string;
      name: string;
      email: string;
      role: Role;
      inviteToken?: string;
      org?: { name: string; taxId: string; type: OrgType };
    }
  | { purpose: "login"; challenge: string };

/** Stores the WebAuthn challenge in a signed, short-lived, httpOnly cookie. */
export async function setChallenge(data: ChallengeData) {
  const token = await new SignJWT({ ...data, typ: "challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(key());
  (await cookies()).set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: secure(),
    sameSite: "strict",
    path: "/api/auth",
    maxAge: CHALLENGE_TTL_SECONDS,
  });
}

/** Reads and deletes the challenge (single use). */
export async function takeChallenge<P extends ChallengeData["purpose"]>(
  purpose: P,
): Promise<Extract<ChallengeData, { purpose: P }> | null> {
  const store = await cookies();
  const token = store.get(CHALLENGE_COOKIE)?.value;
  store.delete({ name: CHALLENGE_COOKIE, path: "/api/auth" });
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.typ !== "challenge" || payload.purpose !== purpose) return null;
    return payload as unknown as Extract<ChallengeData, { purpose: P }>;
  } catch {
    return null;
  }
}
