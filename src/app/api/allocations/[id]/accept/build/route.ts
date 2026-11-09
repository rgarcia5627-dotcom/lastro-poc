import { logActivity } from "@/lib/activity";
import { loadAcceptableAllocation, markAccepted } from "@/lib/allocations";
import { apiClient } from "@/lib/auth";
import { jsonRoute } from "@/lib/http";
import { issuePendingTx } from "@/lib/pending-tx";
import { lastroAsset, operatorKeypair, stellarNetwork } from "@/lib/stellar/config";
import { findTrustline, loadAccount } from "@/lib/stellar/horizon";
import { buildTrustlineTx } from "@/lib/stellar/tx";

type Ctx = { params: Promise<{ id: string }> };

export const POST = jsonRoute<Ctx>(async (_req, { params }) => {
  const user = await apiClient();
  const { id } = await params;
  const { allocation, asset, walletAddress } = await loadAcceptableAllocation(user, id);
  const stellarAsset = lastroAsset(asset.code);

  // Already trusts this token (accepted an earlier transfer): nothing to sign.
  const clientAccount = await loadAccount(walletAddress);
  if (findTrustline(clientAccount, stellarAsset)) {
    await markAccepted(allocation.id, null);
    await logActivity({ actorId: user.id, action: "allocation.accepted", assetId: asset.id, subjectUserId: user.id });
    return Response.json({ done: true });
  }

  const operator = await loadAccount(operatorKeypair().publicKey());
  const tx = buildTrustlineTx({
    source: operator,
    networkPassphrase: stellarNetwork().passphrase,
    client: walletAddress,
    asset: stellarAsset,
  });
  return Response.json(
    await issuePendingTx({ userId: user.id, kind: "trustline", refId: allocation.id, signer: walletAddress, tx }),
  );
});
