import { and, eq, isNull } from "drizzle-orm";
import { logActivity } from "@/lib/activity";
import { apiClient } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { HttpError, jsonRoute, readJson } from "@/lib/http";
import { consumeSignedTx } from "@/lib/pending-tx";
import { operatorKeypair } from "@/lib/stellar/config";
import { submitTx } from "@/lib/stellar/submit";

export const POST = jsonRoute(async (req) => {
  const user = await apiClient();
  if (user.stellarAddress) throw new HttpError(409, "Sua carteira já foi criada.");

  const { xdr } = await readJson(req);
  const tx = await consumeSignedTx({ userId: user.id, kind: "create_wallet", signedXdr: xdr });
  // The client account is the destination of createAccount (op index 1).
  const createOp = tx.operations.find((op) => op.type === "createAccount");
  if (!createOp || createOp.type !== "createAccount") throw new HttpError(400, "Transação inesperada.");

  tx.sign(operatorKeypair());
  const outcome = await submitTx(tx);
  if (outcome.status === "failed") throw new HttpError(502, outcome.message);
  if (outcome.status === "unknown") {
    throw new HttpError(504, "A rede Stellar demorou a responder. Aguarde alguns segundos e tente de novo.");
  }

  await db()
    .update(users)
    .set({ stellarAddress: createOp.destination })
    .where(and(eq(users.id, user.id), isNull(users.stellarAddress)));
  await logActivity({ actorId: user.id, action: "wallet.created", subjectUserId: user.id, txHash: outcome.hash });
  return Response.json({ ok: true, address: createOp.destination, txHash: outcome.hash });
});
