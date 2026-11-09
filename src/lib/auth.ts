import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { type User, users } from "@/lib/db/schema";
import { HttpError } from "@/lib/http";
import { readSession } from "@/lib/session";

export async function currentUser(): Promise<User | null> {
  const session = await readSession();
  if (!session) return null;
  const [user] = await db().select().from(users).where(eq(users.id, session.userId)).limit(1);
  return user ?? null;
}

/** For pages and server actions: redirects when not allowed. */
export async function requireAdmin(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  if (user.role !== "admin") redirect("/app");
  return user;
}

export async function requireClient(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  if (user.role !== "client") redirect("/admin");
  return user;
}

/** For route handlers: throws JSON-friendly errors instead of redirecting. */
export async function apiClient(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sessão expirada. Entre novamente.");
  if (user.role !== "client") throw new HttpError(403, "Acesso restrito a clientes.");
  return user;
}
