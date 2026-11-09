import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminInvites } from "@/lib/db/schema";

export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createAdminInvite(email: string, ttlHours = 72) {
  const token = randomBytes(24).toString("base64url");
  await db()
    .insert(adminInvites)
    .values({
      tokenHash: hashInviteToken(token),
      email: email.trim().toLowerCase(),
      expiresAt: new Date(Date.now() + ttlHours * 3600_000),
    });
  return token;
}

export async function findValidInvite(token: string) {
  const [invite] = await db()
    .select()
    .from(adminInvites)
    .where(
      and(
        eq(adminInvites.tokenHash, hashInviteToken(token)),
        isNull(adminInvites.usedAt),
        gt(adminInvites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return invite ?? null;
}
