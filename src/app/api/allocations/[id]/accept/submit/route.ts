import { logActivity } from "@/lib/activity";
import { loadAcceptableAllocation, markAccepted } from "@/lib/allocations";
import { apiClient } from "@/lib/auth";
import { HttpError, jsonRoute, readJson } from "@/lib/http";
import { consumeSignedTx } from "@/lib/pending-tx";
import { operatorKeypair } from "@/lib/stellar/config";
import { submitTx } from "@/lib/stellar/submit";

type Ctx = { params: Promise<{ id: string }> };

export const POST = jsonRoute<Ctx>(async (req, { params }) => {
  const user = await apiClient();
  const { id } = await params;
  const { allocation, asset } = await loadAcceptableAllocation(user, id);

  const { xdr } = await readJson(req);
  const tx = await consumeSignedTx({ userId: user.id, kind: "trustline", refId: allocation.id, signedXdr: xdr });
  tx.sign(operatorKeypair());

  const outcome = await submitTx(tx);
  if (outcome.status === "failed") throw new HttpError(502, outcome.message);
  if (outcome.status === "unknown") {
    throw new HttpError(504, "A rede Stellar demorou a responder. Aguarde alguns segundos e tente de novo.");
  }

  await markAccepted(allocation.id, outcome.hash);
  await logActivity({
    actorId: user.id,
    action: "allocation.accepted",
    assetId: asset.id,
    subjectUserId: user.id,
    txHash: outcome.hash,
  });
  return Response.json({ ok: true, txHash: outcome.hash });
});
