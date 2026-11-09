import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.role === "admin" ? "/admin" : "/app");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-muted">Use a passkey que você criou no cadastro.</p>
      </div>
      <LoginForm />
      <p className="text-sm text-muted">
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="font-medium text-ink hover:underline">
          Cadastrar instituição
        </Link>
      </p>
    </div>
  );
}
