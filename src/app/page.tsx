import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  redirect(user.role === "admin" ? "/admin" : "/app");
}
