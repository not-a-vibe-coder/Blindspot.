"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import type { BetReceipt, SealedBet } from "@blindspot/sdk";
import { Side } from "@blindspot/sdk";
import { useWallet } from "./wallet";
import { configured } from "./config";
import { loadReceipts } from "./receipts";
import type { MarketView } from "./market";
import { cachedBets, cachedMarkets } from "./logCache";

/** Poll an async loader; keeps the last good value across refreshes. */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], ms = 5000) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++seq.current;
    try {
      const v = await loadRef.current();
      if (id === seq.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(e as Error);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refresh };
}

/**
 * Chain time, ticking locally every second between polls. Phases and countdowns use this,
 * never the wall clock — chain time is what the contract enforces (and what a devnet warps).
 */
export function useChainNow(): bigint {
  const { reader } = useWallet();
  const [offset, setOffset] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!configured) return;
    let alive = true;
    const sync = async () => {
      try {
        const t = await reader.chainTime();
        if (alive) setOffset(Number(t) - Date.now() / 1000);
      } catch {
        /* keep last offset */
      }
    };
    void sync();
    const s = setInterval(sync, 10_000);
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => {
      alive = false;
      clearInterval(s);
      clearInterval(t);
    };
  }, [reader]);
  return BigInt(Math.floor(Date.now() / 1000 + offset));
}

async function loadView(reader: ReturnType<typeof useWallet>["reader"], marketId: bigint, info?: MarketView["info"]): Promise<MarketView> {
  const r = reader.read();
  const [i, pool, resolution, proposal, keyReleased] = await Promise.all([
    info ?? reader.getMarketInfo(marketId),
    r.pool(marketId),
    r.resolution(marketId),
    r.proposal(marketId),
    r.keyReleased(marketId),
  ]);
  return { info: i, pool, resolution, proposal, keyReleased } as MarketView;
}

export function useMarkets() {
  const { reader } = useWallet();
  return usePoll(async () => {
    if (!configured) return [] as MarketView[];
    const list = await cachedMarkets(reader);
    const views = await Promise.all(list.map((m) => loadView(reader, m.marketId, m)));
    return views.sort((a, b) => Number(b.info.marketId - a.info.marketId));
  }, [reader], 8000);
}

export interface BetRow extends SealedBet {
  side: Side;
  claimed: boolean;
}

export function useMarket(marketId: bigint) {
  const { reader } = useWallet();
  const info = useRef<MarketView["info"] | undefined>(undefined);
  return usePoll(async () => {
    if (!info.current) info.current = (await cachedMarkets(reader)).find((m) => m.marketId === marketId);
    if (!configured) throw new Error("not configured");
    const view = await loadView(reader, marketId, info.current);
    info.current = view.info;
    const sealed = await cachedBets(reader, marketId, view.info.createdAtBlock);
    const r = reader.read();
    const bets: BetRow[] = await Promise.all(
      sealed.map(async (b) => {
        const onchain = await r.bet(marketId, b.betId);
        return { ...b, side: onchain.side as Side, claimed: onchain.claimed };
      }),
    );
    return { view, bets };
  }, [reader, marketId.toString()], 5000);
}

/** Receipts saved in this browser, live-updated when a new bet is placed. */
export function useReceipts(owner?: Hex | null): BetReceipt[] {
  const [list, setList] = useState<BetReceipt[]>([]);
  useEffect(() => {
    const load = () =>
      setList(loadReceipts().filter((r) => !owner || r.bettor.toLowerCase() === owner.toLowerCase()));
    load();
    window.addEventListener("blindspot:receipts", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("blindspot:receipts", load);
      window.removeEventListener("storage", load);
    };
  }, [owner]);
  return list;
}
