import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth-forms";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "Cadastro institucional" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const user = await currentUser();
  if (user) redirect(user.role === "admin" ? "/admin" : "/app");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Cadastro institucional</h1>
        <p className="mt-1 text-sm text-muted">Para gestoras, fundos, family offices, plataformas e investidores não residentes.</p>
      </div>
      <SignupForm />
      <p className="text-sm text-muted">
        Já tem conta?{" "}
        <Link href="/entrar" className="font-medium text-ink hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
