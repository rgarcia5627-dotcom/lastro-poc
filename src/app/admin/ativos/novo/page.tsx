import { ActionForm } from "@/components/action-form";
import { AssetFields } from "@/components/asset-fields";
import { Card, PageHeader } from "@/components/ui";
import { createAsset } from "@/lib/actions/assets";

export const metadata = { title: "Novo ativo" };

export default function NewAssetPage() {
  return (
    <>
      <PageHeader title="Novo ativo" description="O ativo fica em rascunho até você tokenizar. Nada vai para a rede antes disso." />
      <Card>
        <ActionForm action={createAsset} submitLabel="Salvar rascunho" pendingLabel="Salvando…">
          <AssetFields />
        </ActionForm>
      </Card>
    </>
  );
}
