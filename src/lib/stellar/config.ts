import { Asset, Horizon, Keypair, Networks } from "@stellar/stellar-sdk";
import { env } from "@/lib/env";

export class StellarConfigError extends Error {}

export function stellarNetwork() {
  const name = env().STELLAR_NETWORK;
  const isPublic = name === "public";
  return {
    name,
    passphrase: isPublic ? Networks.PUBLIC : Networks.TESTNET,
    horizonUrl: env().HORIZON_URL ?? (isPublic ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org"),
    explorerUrl: `https://stellar.expert/explorer/${isPublic ? "public" : "testnet"}`,
  };
}

let server: Horizon.Server | undefined;
export function horizon(): Horizon.Server {
  if (!server) server = new Horizon.Server(stellarNetwork().horizonUrl);
  return server;
}

function keypairFrom(secret: string | undefined, name: string): Keypair {
  if (!secret) throw new StellarConfigError(`${name} não configurada. Rode \`pnpm stellar:setup\`.`);
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new StellarConfigError(`${name} inválida.`);
  }
}

/** Issues every Lastro token. Holds no balances of its own tokens. */
export const issuerKeypair = () => keypairFrom(env().LASTRO_ISSUER_SECRET, "LASTRO_ISSUER_SECRET");
/** Treasury + fee payer + reserve sponsor for client accounts and trustlines. */
export const operatorKeypair = () => keypairFrom(env().LASTRO_OPERATOR_SECRET, "LASTRO_OPERATOR_SECRET");

export function lastroAsset(code: string): Asset {
  return new Asset(code, issuerKeypair().publicKey());
}

export const explorerTxUrl = (hash: string) => `${stellarNetwork().explorerUrl}/tx/${hash}`;
export const explorerAccountUrl = (address: string) => `${stellarNetwork().explorerUrl}/account/${address}`;
export const explorerAssetUrl = (code: string) =>
  `${stellarNetwork().explorerUrl}/asset/${code}-${issuerKeypair().publicKey()}`;
