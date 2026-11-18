import { createPublicClient, http, type Chain, type Hex, type PublicClient } from "viem";
import { foundry } from "viem/chains";
import { qorechainMainnet, qorechainTestnet } from "@blindspot/sdk";

/**
 * Deployment config — all public, baked in at build time.
 *   NEXT_PUBLIC_CHAIN_ID            9800 (QoreChain testnet) | 9801 (mainnet) | 31337 (local devnet)
 *   NEXT_PUBLIC_RPC_URL             optional override of the chain's default RPC
 *   NEXT_PUBLIC_BLINDSPOT_ADDRESS   BlindspotMarkets address
 *   NEXT_PUBLIC_FROM_BLOCK          deployment block (log scans start here)
 *   NEXT_PUBLIC_LOG_CHUNK           max eth_getLogs block range (default 5000)
 *   NEXT_PUBLIC_RPC_PROXY           "1" → browser reads go through /api/rpc on our origin
 *                                   (default on for QoreChain, off for the local devnet)
 */
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const BASE: Record<number, Chain> = { 9800: qorechainTestnet, 9801: qorechainMainnet, 31337: foundry };

const base = BASE[CHAIN_ID] ?? { ...qorechainTestnet, id: CHAIN_ID };
const rpc = process.env.NEXT_PUBLIC_RPC_URL || base.rpcUrls.default.http[0]!;

export const chain: Chain = {
  ...base,
  name: CHAIN_ID === 31337 ? "Blindspot Devnet" : base.name,
  nativeCurrency: CHAIN_ID === 31337 ? { name: "QOR", symbol: "QOR", decimals: 18 } : base.nativeCurrency,
  rpcUrls: { default: { http: [rpc] } },
};

export const config = {
  chain,
  chainId: CHAIN_ID,
  rpc,
  address: (process.env.NEXT_PUBLIC_BLINDSPOT_ADDRESS ?? "") as Hex,
  fromBlock: BigInt(process.env.NEXT_PUBLIC_FROM_BLOCK ?? "0"),
  logChunk: BigInt(process.env.NEXT_PUBLIC_LOG_CHUNK ?? "5000"),
  isDevnet: CHAIN_ID === 31337,
  explorer: chain.blockExplorers?.default.url,
  symbol: chain.nativeCurrency.symbol,
} as const;

export const configured = /^0x[0-9a-fA-F]{40}$/.test(config.address);

const useProxy = (process.env.NEXT_PUBLIC_RPC_PROXY ?? (CHAIN_ID === 31337 ? "0" : "1")) === "1";

/** URL the app reads through: our own /api/rpc proxy in the browser, else the chain RPC. */
function readUrl(): string {
  if (useProxy && typeof window !== "undefined") return `${window.location.origin}/api/rpc`;
  return rpc;
}

let _public: PublicClient | null = null;
export function publicClient(): PublicClient {
  if (typeof window === "undefined") {
    // never cache a server-side client: the browser must build its own (proxy URL)
    return createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
  }
  _public ??= createPublicClient({ chain, transport: http(readUrl(), { batch: { batchSize: 40 } }) }) as PublicClient;
  return _public;
}
