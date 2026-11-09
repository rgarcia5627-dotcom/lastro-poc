import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments } from "@/lib/db/schema";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "Registro não encontrado." }, { status: 404 });

/**
 * The payment record exactly as hashed and registered on Stellar: public, so anyone doing
 * diligence can check it. sha256(body) equals the registry transaction's memo (and, for the
 * latest payment of the asset, the issuer's `lastro:pay:<CODE>` data entry).
 * It lists wallet addresses and amounts only, the same data the ledger already makes public;
 * institution names stay in the admin-only holder list.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();

  const [payment] = await db()
    .select({ record: payments.record, recordHash: payments.recordHash, status: payments.status })
    .from(payments)
    .where(eq(payments.id, id))
    .limit(1);
  if (!payment?.record || !payment.recordHash || payment.status !== "paid") return notFound();

  return new Response(payment.record, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `inline; filename="lastro-pagamento-${id}.json"`,
      "x-record-sha256": payment.recordHash,
      // A registered record never changes; external verifiers may fetch it cross-origin.
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "x-record-sha256",
    },
  });
}
