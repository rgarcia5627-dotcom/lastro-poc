import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { clearSession } from "@/lib/session";

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(env().APP_ORIGIN).origin) {
    return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  }
  await clearSession();
  return NextResponse.redirect(new URL("/entrar", env().APP_ORIGIN), 303);
}
