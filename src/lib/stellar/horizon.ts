import type { Asset, Horizon } from "@stellar/stellar-sdk";
import { horizon, issuerKeypair, operatorKeypair } from "./config";

export type Holder = {
  address: string;
  balance: string;
  authorized: boolean;
  clawbackEnabled: boolean;
};

type AccountLike = Pick<Horizon.AccountResponse, "balances">;

export function findTrustline(account: AccountLike, asset: Asset) {
  for (const b of account.balances) {
    if (
      (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
      b.asset_code === asset.getCode() &&
      b.asset_issuer === asset.getIssuer()
    ) {
      return b;
    }
  }
  return null;
}

export class AccountNotFoundError extends Error {}

export async function loadAccount(address: string): Promise<Horizon.AccountResponse> {
  try {
    return await horizon().loadAccount(address);
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 404 || (err as Error)?.name === "NotFoundError") throw new AccountNotFoundError(address);
    throw err;
  }
}

export async function accountExists(address: string): Promise<boolean> {
  try {
    await loadAccount(address);
    return true;
  } catch (err) {
    if (err instanceof AccountNotFoundError) return false;
    throw err;
  }
}

/** Every account with a trustline to `asset` (authorized or not), with its balance. */
export async function listHolders(asset: Asset): Promise<Holder[]> {
  const holders: Holder[] = [];
  let page = await horizon().accounts().forAsset(asset).limit(200).call();
  for (;;) {
    for (const account of page.records) {
      const line = findTrustline(account, asset);
      if (!line) continue;
      holders.push({
        address: account.account_id,
        balance: line.balance,
        authorized: line.is_authorized,
        clawbackEnabled: Boolean(line.is_clawback_enabled),
      });
    }
    if (page.records.length < 200) break;
    page = await page.next();
  }
  return holders;
}

/** Balances of Lastro-issued tokens held by `address`, keyed by asset code. */
export async function lastroBalances(address: string): Promise<Map<string, { balance: string; authorized: boolean }>> {
  const issuer = issuerKeypair().publicKey();
  const account = await loadAccount(address);
  const out = new Map<string, { balance: string; authorized: boolean }>();
  for (const b of account.balances) {
    if ((b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") && b.asset_issuer === issuer) {
      out.set(b.asset_code, { balance: b.balance, authorized: b.is_authorized });
    }
  }
  return out;
}

export type LastroHealth = {
  issuer: { address: string; exists: boolean; flagsOk: boolean };
  operator: { address: string; exists: boolean; xlm: string | null; sponsoring: number };
};

/** On-chain health of Lastro's two accounts (used by the admin dashboard and setup). */
export async function lastroHealth(): Promise<LastroHealth> {
  const issuer = issuerKeypair().publicKey();
  const operator = operatorKeypair().publicKey();
  const [issuerAcc, operatorAcc] = await Promise.all([
    loadAccount(issuer).catch((e) => (e instanceof AccountNotFoundError ? null : Promise.reject(e))),
    loadAccount(operator).catch((e) => (e instanceof AccountNotFoundError ? null : Promise.reject(e))),
  ]);
  const flags = issuerAcc?.flags;
  const native = operatorAcc?.balances.find((b) => b.asset_type === "native");
  return {
    issuer: {
      address: issuer,
      exists: Boolean(issuerAcc),
      flagsOk: Boolean(flags?.auth_required && flags?.auth_revocable && flags?.auth_clawback_enabled),
    },
    operator: {
      address: operator,
      exists: Boolean(operatorAcc),
      xlm: native ? native.balance : null,
      sponsoring: Number((operatorAcc as unknown as { num_sponsoring?: number } | null)?.num_sponsoring ?? 0),
    },
  };
}
