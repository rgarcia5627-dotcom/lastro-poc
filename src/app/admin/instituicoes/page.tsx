import { desc, eq } from "drizzle-orm";
import { ActionButton } from "@/components/action-form";
import { Card, EmptyState, ExternalLink, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { setKycStatus } from "@/lib/actions/clients";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { formatDateTime, shortAddress } from "@/lib/format";
import { KYC_STATUS, orgTypeLabel } from "@/lib/labels";
import { explorerAccountUrl } from "@/lib/stellar/config";

export const metadata = { title: "Instituições" };

export default async function InstitutionsPage() {
  const rows = await db().select().from(users).where(eq(users.role, "client")).orderBy(desc(users.createdAt));
  return (
    <>
      <PageHeader
        title="Instituições"
        description="A Lastro atende apenas investidores profissionais. Só instituições com KYB aprovado recebem cenários e tokens; a aprovação aqui registra a diligência feita pela Lastro."
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState>Nenhuma instituição cadastrada ainda.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Instituição</Th>
                <Th>Representante</Th>
                <Th>Carteira Stellar</Th>
                <Th>Cadastro</Th>
                <Th>KYB</Th>
                <Th>Ações</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inst) => (
                <tr key={inst.id}>
                  <Td>
                    <div className="font-medium">{inst.orgName ?? "—"}</div>
                    <div className="text-xs text-muted">
                      {orgTypeLabel(inst.orgType)} · {inst.orgTaxId ?? "—"}
                    </div>
                    {inst.professionalDeclaredAt && <div className="text-xs text-muted">Declarou-se investidor profissional</div>}
                  </Td>
                  <Td>
                    <div>{inst.name}</div>
                    <div className="text-xs text-muted">{inst.email}</div>
                  </Td>
                  <Td>
                    {inst.stellarAddress ? (
                      <ExternalLink href={explorerAccountUrl(inst.stellarAddress)}>{shortAddress(inst.stellarAddress)}</ExternalLink>
                    ) : (
                      <span className="text-muted">Ainda não criada</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(inst.createdAt)}</Td>
                  <Td>
                    <StatusBadge map={KYC_STATUS} value={inst.kycStatus} />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {inst.kycStatus !== "approved" && (
                        <ActionButton action={setKycStatus.bind(null, inst.id, "approved")} label="Aprovar" variant="primary" />
                      )}
                      {inst.kycStatus !== "rejected" && (
                        <ActionButton
                          action={setKycStatus.bind(null, inst.id, "rejected")}
                          label="Reprovar"
                          confirm="Reprovar o KYB?"
                          variant="ghost"
                        />
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
