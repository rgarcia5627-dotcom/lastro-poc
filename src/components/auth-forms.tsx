"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createWallet, errorMessage, postJSON } from "@/lib/client/passkey-wallet";
import { ORG_TYPES } from "@/lib/labels";
import { Button, Field, inputClass } from "./ui";

function passkeyError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError") return "Operação cancelada ou expirada.";
  if (name === "InvalidStateError") return "Esta passkey já está cadastrada. Use “Entrar”.";
  return errorMessage(err);
}

export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await postJSON<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
        "/api/auth/login/options",
        {},
      );
      const response = await startAuthentication({ optionsJSON });
      const result = await postJSON<{ role: "admin" | "client" }>("/api/auth/login/verify", { response });
      router.push(result.role === "admin" ? "/admin" : "/app");
      router.refresh();
    } catch (err) {
      setError(passkeyError(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button className="w-full" onClick={login} disabled={busy}>
        {busy ? "Aguardando a passkey…" : "Entrar com passkey"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type Step = "form" | "passkey" | "wallet";

export function SignupForm({ inviteToken, inviteEmail }: { inviteToken?: string; inviteEmail?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const isAdmin = Boolean(inviteToken);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const email = inviteEmail ?? String(form.get("email") ?? "");
    const org = isAdmin
      ? undefined
      : {
          name: String(form.get("orgName") ?? ""),
          taxId: String(form.get("orgTaxId") ?? ""),
          type: String(form.get("orgType") ?? ""),
          professional: form.get("professional") === "on",
        };
    setError(null);
    setStep("passkey");
    let registered: { role: "admin" | "client"; credentialId: string; rpId: string };
    try {
      const optionsJSON = await postJSON<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
        "/api/auth/register/options",
        { name, email, inviteToken, org },
      );
      const response = await startRegistration({ optionsJSON });
      registered = await postJSON("/api/auth/register/verify", { response });
    } catch (err) {
      setError(passkeyError(err));
      setStep("form");
      return;
    }

    if (registered.role === "admin") {
      router.push("/admin");
      router.refresh();
      return;
    }

    setStep("wallet");
    try {
      await createWallet(registered.credentialId, registered.rpId);
      router.push("/app");
    } catch {
      // The account exists; the wallet page explains the problem and offers a retry.
      router.push("/app?carteira=pendente");
    }
    router.refresh();
  }

  if (step === "wallet") {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium">Criando a carteira Stellar da instituição…</p>
        <p className="text-muted">Confirme mais uma vez com a sua passkey. A chave da carteira é gerada no seu dispositivo e nunca sai dele.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {!isAdmin && (
        <>
          <Field label="Instituição (razão social)">
            <input name="orgName" required minLength={2} autoComplete="organization" className={inputClass} disabled={step !== "form"} />
          </Field>
          <Field label="CNPJ ou registro no exterior">
            <input name="orgTaxId" required minLength={5} maxLength={40} className={inputClass} disabled={step !== "form"} placeholder="00.000.000/0001-00" />
          </Field>
          <Field label="Tipo de instituição">
            <select name="orgType" required defaultValue="" className={inputClass} disabled={step !== "form"}>
              <option value="" disabled>
                Escolha
              </option>
              {ORG_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      <Field label={isAdmin ? "Nome completo" : "Nome completo do representante"}>
        <input name="name" required minLength={2} autoComplete="name" className={inputClass} disabled={step !== "form"} />
      </Field>
      <Field label={isAdmin ? "E-mail" : "E-mail corporativo"}>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
          defaultValue={inviteEmail}
          readOnly={Boolean(inviteEmail)}
          disabled={step !== "form"}
        />
      </Field>
      {!isAdmin && (
        <label className="flex items-start gap-2 text-sm">
          <input name="professional" type="checkbox" required className="mt-0.5" disabled={step !== "form"} />
          <span>Declaro que a instituição é investidor profissional e que tenho poderes para representá-la.</span>
        </label>
      )}
      <Button type="submit" className="w-full" disabled={step !== "form"}>
        {step === "passkey" ? "Aguardando a passkey…" : isAdmin ? "Criar acesso de administrador" : "Criar conta com passkey"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {!isAdmin && (
        <p className="text-xs text-muted">
          A Lastro atende apenas investidores profissionais. Sem senha: você entra com a biometria ou o PIN do seu
          dispositivo, e a mesma passkey gera e protege a carteira da instituição na rede Stellar.
        </p>
      )}
    </form>
  );
}
