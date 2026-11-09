import { StrKey } from "@stellar/stellar-sdk";
import { and, eq, isNull } from "drizzle-orm";
import { logActivity } from "@/lib/activity";
import { apiClient } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { HttpError, jsonRoute, readJson } from "@/lib/http";
import { issuePendingTx } from "@/lib/pending-tx";
import { operatorKeypair, stellarNetwork } from "@/lib/stellar/config";
import { accountExists, loadAccount } from "@/lib/stellar/horizon";
import { buildCreateWalletTx } from "@/lib/stellar/tx";

export const POST = jsonRoute(async (req) => {
  const user = await apiClient();
  if (user.stellarAddress) throw new HttpError(409, "Sua carteira já foi criada.");

  const { publicKey } = await readJson(req);
  if (typeof publicKey !== "string" || !StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new HttpError(400, "Chave pública inválida.");
  }

  // The key is derived from this user's passkey, so an existing account is theirs
  // (a previous attempt that landed on-chain but did not reach our database).
  if (await accountExists(publicKey)) {
    await db()
      .update(users)
      .set({ stellarAddress: publicKey })
      .where(and(eq(users.id, user.id), isNull(users.stellarAddress)));
    await logActivity({ actorId: user.id, action: "wallet.created", subjectUserId: user.id });
    return Response.json({ done: true });
  }

  const operator = await loadAccount(operatorKeypair().publicKey());
  const tx = buildCreateWalletTx({
    source: operator,
    networkPassphrase: stellarNetwork().passphrase,
    client: publicKey,
  });
  return Response.json(await issuePendingTx({ userId: user.id, kind: "create_wallet", signer: publicKey, tx }));
});
