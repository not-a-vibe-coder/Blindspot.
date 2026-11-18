import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { BlindspotClient, qorechainMainnet, qorechainTestnet } from "@blindspot/sdk";

const CHAINS: Record<number, Chain> = { 9800: qorechainTestnet, 9801: qorechainMainnet, 31337: foundry };

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`missing env ${name} (see .env.example)`);
  return v;
}

/** Deployment address: BLINDSPOT_ADDRESS, else contracts/deployments/<chainId>.json. */
function deployment(chainId: number): { address: Hex; fromBlock: bigint } {
  if (process.env.BLINDSPOT_ADDRESS) {
    return { address: process.env.BLINDSPOT_ADDRESS as Hex, fromBlock: BigInt(process.env.FROM_BLOCK ?? "0") };
  }
  const file = resolve(import.meta.dirname, "../../../contracts/deployments", `${chainId}.json`);
  if (!existsSync(file)) throw new Error(`no BLINDSPOT_ADDRESS and no ${file} — deploy first`);
  const d = JSON.parse(readFileSync(file, "utf8"));
  return { address: d.BlindspotMarkets, fromBlock: BigInt(process.env.FROM_BLOCK ?? d.deployedAtBlock ?? 0) };
}

export async function loadClient(): Promise<BlindspotClient> {
  const rpc = env("RPC_URL", qorechainTestnet.rpcUrls.default.http[0]);
  const probe = createPublicClient({ transport: http(rpc) });
  const chainId = await probe.getChainId();
  const chain = CHAINS[chainId] ?? { ...qorechainTestnet, id: chainId };

  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const account = privateKeyToAccount(env("PRIVATE_KEY") as Hex);
  const walletClient = createWalletClient({ chain, transport: http(rpc), account });
  const { address, fromBlock } = deployment(chainId);

  return new BlindspotClient({
    address,
    publicClient: publicClient as never,
    walletClient,
    fromBlock,
    logChunk: BigInt(process.env.LOG_CHUNK ?? "5000"),
  });
}

export const keysDir = () => resolve(process.env.KEYS_DIR ?? resolve(import.meta.dirname, "../keys"));
export const passphrase = () => env("KEYPER_PASSPHRASE");
export const pollMs = () => Number(process.env.POLL_MS ?? "15000");

/** "+2h", "+30m", "+7d", a unix timestamp, or an ISO date → unix seconds. */
export function parseTime(input: string, base: bigint): bigint {
  const rel = /^\+(\d+)([smhd])$/.exec(input);
  if (rel) {
    const mult = { s: 1n, m: 60n, h: 3600n, d: 86_400n }[rel[2] as "s" | "m" | "h" | "d"];
    return base + BigInt(rel[1]!) * mult;
  }
  if (/^\d+$/.test(input)) return BigInt(input);
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) throw new Error(`can't parse time "${input}"`);
  return BigInt(Math.floor(ms / 1000));
}

/** "1h" / "30m" / "7d" → seconds. */
export function parseDuration(input: string): bigint {
  return parseTime(`+${input}`, 0n);
}
