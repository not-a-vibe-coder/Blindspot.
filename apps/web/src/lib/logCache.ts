import type { BlindspotClient, MarketInfo, SealedBet } from "@blindspot/sdk";

/**
 * Incremental event-log cache. Each poll scans only the blocks since the last scan
 * (from a fixed head taken before scanning), instead of re-reading the chain from the
 * deployment block every few seconds. Results are de-duplicated by id.
 */
const markets = { list: new Map<string, MarketInfo>(), next: null as bigint | null };
const bets = new Map<string, { list: Map<string, SealedBet>; next: bigint }>();

export async function cachedMarkets(reader: BlindspotClient): Promise<MarketInfo[]> {
  const head = await reader.head();
  const from = markets.next ?? reader.fromBlock;
  if (from <= head) {
    for (const m of await reader.listMarkets(from)) markets.list.set(m.marketId.toString(), m);
    markets.next = head + 1n;
  }
  return [...markets.list.values()];
}

export async function cachedBets(reader: BlindspotClient, marketId: bigint, createdAtBlock: bigint): Promise<SealedBet[]> {
  const key = marketId.toString();
  const entry = bets.get(key) ?? { list: new Map<string, SealedBet>(), next: createdAtBlock };
  const head = await reader.head();
  if (entry.next <= head) {
    for (const b of await reader.getSealedBets(marketId, entry.next)) entry.list.set(b.betId.toString(), b);
    entry.next = head + 1n;
  }
  bets.set(key, entry);
  return [...entry.list.values()].sort((a, b) => Number(a.betId - b.betId));
}
