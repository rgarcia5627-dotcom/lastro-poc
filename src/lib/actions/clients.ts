"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { type KycStatus, users } from "@/lib/db/schema";
import type { ActionState } from "./shared";

export async function setKycStatus(
  userId: string,
  status: KycStatus,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const updated = await db()
    .update(users)
    .set({ kycStatus: status })
    .where(and(eq(users.id, userId), eq(users.role, "client")))
    .returning({ id: users.id });
  if (!updated.length) return { error: "Instituição não encontrada." };
  await logActivity({ actorId: admin.id, action: "kyc.updated", subjectUserId: userId, detail: { status } });
  revalidatePath("/admin", "layout");
  return { ok: "KYB atualizado." };
}
