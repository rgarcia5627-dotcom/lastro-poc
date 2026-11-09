import { and, desc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { ScenarioInputs } from "@/components/scenario";
import { Card, Field, inputClass, Notice, PageHeader } from "@/components/ui";
import { createProposal } from "@/lib/actions/proposals";
import { db } from "@/lib/db";
import { assets, users } from "@/lib/db/schema";
import { formatBRL } from "@/lib/format";
import { MAX_SCENARIOS, scenarioLetter } from "@/lib/proposals";

export const metadata = { title: "Nova proposta" };

export default async function NewProposalPage({ searchParams }: { searchParams: Promise<{ ativo?: string }> }) {
  const { ativo } = await searchParams;
  const [draftAssets, institutions] = await Promise.all([
    db().select().from(assets).where(eq(assets.status, "draft")).orderBy(desc(assets.createdAt)),
    db()
      .select()
      .from(users)
      .where(and(eq(users.role, "client"), eq(users.kycStatus, "approved")))
      .orderBy(users.orgName),
  ]);

  return (
    <>
      <PageHeader
        title="Nova proposta"
        description="Monte até três cenários de estrutura para a instituição. Ela escolhe um, edita o que quiser e devolve; você confirma com o cliente e fecha."
      />
      <Card>
        {draftAssets.length === 0 || institutions.length === 0 ? (
          <Notice>
            {draftAssets.length === 0
              ? "Cadastre a operação como ativo em rascunho primeiro: a estrutura é fechada antes da tokenização."
              : "Nenhuma instituição com KYB aprovado."}
          </Notice>
        ) : (
          <ActionForm action={createProposal} submitLabel="Enviar cenários à instituição" pendingLabel="Enviando…">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Operação (ativo em rascunho)">
                <select name="assetId" required className={inputClass} defaultValue={ativo ?? ""}>
                  <option value="" disabled>
                    Escolha
                  </option>
                  {draftAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name} ({formatBRL(a.totalVolume)})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Instituição">
                <select name="userId" required className={inputClass} defaultValue="">
                  <option value="" disabled>
                    Escolha
                  </option>
                  {institutions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.orgName ?? c.name} — {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {Array.from({ length: MAX_SCENARIOS }, (_, i) => (
              <fieldset key={i} className="rounded-lg border border-line p-4">
                <legend className="px-1 text-sm font-semibold">
                  Cenário {scenarioLetter(i)}
                  {i > 0 && <span className="font-normal text-muted"> (opcional)</span>}
                </legend>
                <ScenarioInputs index={i} />
              </fieldset>
            ))}
          </ActionForm>
        )}
      </Card>
    </>
  );
}
