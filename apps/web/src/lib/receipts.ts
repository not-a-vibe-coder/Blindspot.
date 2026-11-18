import type { Hex } from "viem";
import type { BetReceipt } from "@blindspot/sdk";
import { config } from "./config";

/**
 * Your sealed sides live only in your browser (and in the downloadable receipt):
 * the chain never sees them until reveal. A receipt lets you self-reveal if the keyper
 * goes dark, and lets the app show *your* side while everyone else sees a sealed chip.
 */
const KEY = () => `blindspot:receipts:${config.chainId}:${config.address.toLowerCase()}`;

type Stored = Omit<BetReceipt, "marketId" | "betId"> & { marketId: string; betId?: string };

const toStored = (r: BetReceipt): Stored => ({ ...r, marketId: r.marketId.toString(), betId: r.betId?.toString() });
const fromStored = (s: Stored): BetReceipt => ({
  ...s,
  marketId: BigInt(s.marketId),
  betId: s.betId !== undefined ? BigInt(s.betId) : undefined,
});

export function loadReceipts(): BetReceipt[] {
  if (typeof window === "undefined") return [];
  try {
    return (JSON.parse(localStorage.getItem(KEY()) ?? "[]") as Stored[]).map(fromStored);
  } catch {
    return [];
  }
}

export function saveReceipt(r: BetReceipt) {
  const all = loadReceipts().filter((x) => !(x.marketId === r.marketId && x.betId === r.betId && x.bettor === r.bettor));
  all.push(r);
  try {
    localStorage.setItem(KEY(), JSON.stringify(all.map(toStored)));
  } catch {
    /* storage full / disabled — the download is the backup */
  }
  window.dispatchEvent(new Event("blindspot:receipts"));
}

export function receiptFor(marketId: bigint, betId: bigint, bettor?: Hex | null): BetReceipt | undefined {
  return loadReceipts().find(
    (r) => r.marketId === marketId && r.betId === betId && (!bettor || r.bettor.toLowerCase() === bettor.toLowerCase()),
  );
}

export function importReceipts(json: string): number {
  const parsed = JSON.parse(json) as Stored | Stored[];
  const list = (Array.isArray(parsed) ? parsed : [parsed]).map(fromStored);
  for (const r of list) {
    if (!r.salt || !r.commitment || (r.side !== 1 && r.side !== 2)) throw new Error("not a Blindspot receipt");
    saveReceipt(r);
  }
  return list.length;
}

export function downloadReceipt(r: BetReceipt) {
  const blob = new Blob([JSON.stringify(toStored(r), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `blindspot-receipt-m${r.marketId}-b${r.betId ?? "pending"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
