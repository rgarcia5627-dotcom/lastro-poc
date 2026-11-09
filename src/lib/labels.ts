import type {
  AllocationStatus,
  AssetKind,
  AssetStatus,
  KycStatus,
  OrgType,
  PaymentKind,
  PaymentStatus,
  ProposalStatus,
} from "@/lib/db/schema";

export type Tone = "neutral" | "brand" | "ok" | "warn" | "danger";

export const ASSET_KINDS: { value: AssetKind; label: string }[] = [
  { value: "CR", label: "CR — Certificado de Recebíveis" },
  { value: "CCB", label: "CCB — Cédula de Crédito Bancário" },
  { value: "CRI", label: "CRI — Certificado de Recebíveis Imobiliários" },
  { value: "CRA", label: "CRA — Certificado de Recebíveis do Agronegócio" },
  { value: "DEBENTURE", label: "Debênture" },
  { value: "PRECATORIO", label: "Precatório / direito creditório" },
  { value: "OUTRO", label: "Outro" },
];

export const assetKindLabel = (k: AssetKind) => ASSET_KINDS.find((x) => x.value === k)?.value ?? k;

export const ASSET_STATUS: Record<AssetStatus, [string, Tone]> = {
  draft: ["Rascunho", "neutral"],
  tokenizing: ["Tokenizando", "warn"],
  tokenized: ["Tokenizado", "ok"],
};

export const PROPOSAL_STATUS: Record<ProposalStatus, [string, Tone]> = {
  with_institution: ["Com a instituição", "warn"],
  with_lastro: ["Com a Lastro", "brand"],
  closed: ["Fechada", "ok"],
  cancelled: ["Cancelada", "neutral"],
};

/** KYB: the institution's onboarding review (the column is still `kyc_status`). */
export const KYC_STATUS: Record<KycStatus, [string, Tone]> = {
  pending: ["KYB pendente", "warn"],
  approved: ["KYB aprovado", "ok"],
  rejected: ["KYB reprovado", "danger"],
};

/** Lastro serves professional investors only: institutions, no retail. */
export const ORG_TYPES: { value: OrgType; label: string }[] = [
  { value: "gestora", label: "Gestora de recursos" },
  { value: "fundo", label: "Fundo de investimento" },
  { value: "family_office", label: "Family office" },
  { value: "plataforma", label: "Plataforma de investimento / distribuidora" },
  { value: "banco", label: "Banco / instituição financeira" },
  { value: "seguradora_previdencia", label: "Seguradora / previdência" },
  { value: "nao_residente", label: "Investidor não residente (4.373)" },
];

export const orgTypeLabel = (t: OrgType | null) => (t ? (ORG_TYPES.find((x) => x.value === t)?.label ?? t) : "—");

export const ALLOCATION_STATUS: Record<AllocationStatus, [string, Tone]> = {
  pending: ["Aguardando aceite", "warn"],
  accepted: ["Aceito — aguardando envio", "brand"],
  transferring: ["Enviando", "warn"],
  transferred: ["Transferido", "ok"],
  declined: ["Recusado", "neutral"],
  cancelled: ["Cancelado", "neutral"],
};

export const PAYMENT_KINDS: { value: PaymentKind; label: string }[] = [
  { value: "juros", label: "Juros" },
  { value: "amortizacao", label: "Amortização" },
  { value: "juros_amortizacao", label: "Juros + amortização" },
];

export const paymentKindLabel = (k: PaymentKind) => PAYMENT_KINDS.find((x) => x.value === k)?.label ?? k;

export const PAYMENT_STATUS: Record<PaymentStatus, [string, Tone]> = {
  scheduled: ["Previsto", "neutral"],
  snapshotted: ["Lista fechada", "brand"],
  registering: ["Registrando", "warn"],
  paid: ["Pago", "ok"],
};
