import { asc, eq } from "drizzle-orm";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { paymentItems, payments, users } from "@/lib/db/schema";

type Ctx = { params: Promise<{ id: string }> };

const csvCell = (value: string) => (/[;"\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/**
 * The closed holder list of a payment, for the paying agent to settle off-chain in BRL.
 * Admin only: it names the institutions. Amounts are the ones that go into the on-chain payment record.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Acesso restrito." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Pagamento não encontrado." }, { status: 404 });

  const [payment] = await db().select({ status: payments.status }).from(payments).where(eq(payments.id, id)).limit(1);
  if (!payment || payment.status === "scheduled") {
    return Response.json({ error: "A lista deste pagamento ainda não foi fechada." }, { status: 404 });
  }

  const rows = await db()
    .select({
      orgName: users.orgName,
      taxId: users.orgTaxId,
      address: paymentItems.stellarAddress,
      quantity: paymentItems.quantity,
      amount: paymentItems.amount,
    })
    .from(paymentItems)
    .leftJoin(users, eq(users.id, paymentItems.userId))
    .where(eq(paymentItems.paymentId, id))
    .orderBy(asc(paymentItems.stellarAddress));

  const lines = [
    "instituicao;cnpj_ou_registro;conta_stellar;tokens;valor_brl",
    ...rows.map((r) => [r.orgName ?? "", r.taxId ?? "", r.address, r.quantity, r.amount].map(csvCell).join(";")),
  ];
  return new Response(`${lines.join("\n")}\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lastro-lista-${id}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
