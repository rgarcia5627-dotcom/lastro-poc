import type { AssetRow } from "@/lib/db/schema";
import { plainDecimal } from "@/lib/format";
import { ASSET_KINDS } from "@/lib/labels";
import { Field, inputClass } from "./ui";

/** Inputs for an asset; rendered inside an ActionForm. */
export function AssetFields({ asset }: { asset?: AssetRow }) {
  const locked = Boolean(asset && asset.status !== "draft");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nome do ativo" className="sm:col-span-2">
        <input name="name" required defaultValue={asset?.name} className={inputClass} placeholder="CR Kalata 2026" />
      </Field>
      <Field label="Tipo">
        <select name="kind" required defaultValue={asset?.kind ?? "CR"} className={inputClass}>
          {ASSET_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Emissor / devedor">
        <input name="issuerName" required defaultValue={asset?.issuerName} className={inputClass} placeholder="Securitizadora XYZ S.A." />
      </Field>
      <Field
        label="Código do token"
        hint={locked ? "Não pode mudar depois da tokenização." : "1 a 12 letras/números. Aparece nas carteiras e no explorer."}
      >
        <input
          name="code"
          required
          maxLength={12}
          defaultValue={asset?.code}
          readOnly={locked}
          className={`${inputClass} uppercase`}
          placeholder="LCR001"
        />
      </Field>
      <Field label="Quantidade de tokens" hint={locked ? "Emitida na tokenização." : "Total emitido na tesouraria da Lastro."}>
        <input
          name="tokenSupply"
          required
          inputMode="decimal"
          defaultValue={asset ? plainDecimal(asset.tokenSupply) : undefined}
          readOnly={locked}
          className={inputClass}
          placeholder="15000"
        />
      </Field>
      <Field label="Volume total (R$)">
        <input
          name="totalVolume"
          required
          inputMode="decimal"
          defaultValue={asset ? plainDecimal(asset.totalVolume) : undefined}
          className={inputClass}
          placeholder="15000000"
        />
      </Field>
      <Field label="PU inicial (R$ por token)">
        <input
          name="unitPrice"
          required
          inputMode="decimal"
          defaultValue={asset ? plainDecimal(asset.unitPrice) : undefined}
          className={inputClass}
          placeholder="1000"
        />
      </Field>
      <Field label="Remuneração">
        <input name="remuneration" defaultValue={asset?.remuneration ?? ""} className={inputClass} placeholder="CDI + 4,5% a.a." />
      </Field>
      <Field label="Periodicidade de pagamento">
        <input name="paymentFrequency" defaultValue={asset?.paymentFrequency ?? ""} className={inputClass} placeholder="Mensal" />
      </Field>
      <Field label="Data de emissão">
        <input name="issueDate" type="date" defaultValue={asset?.issueDate ?? ""} className={inputClass} />
      </Field>
      <Field label="Vencimento">
        <input name="maturityDate" type="date" defaultValue={asset?.maturityDate ?? ""} className={inputClass} />
      </Field>
      <Field label="Link dos documentos" className="sm:col-span-2" hint="Termo de securitização, lâmina, etc.">
        <input name="documentsUrl" type="url" defaultValue={asset?.documentsUrl ?? ""} className={inputClass} placeholder="https://" />
      </Field>
      <Field label="Descrição" className="sm:col-span-2">
        <textarea name="description" rows={3} defaultValue={asset?.description ?? ""} className={inputClass} />
      </Field>
    </div>
  );
}
