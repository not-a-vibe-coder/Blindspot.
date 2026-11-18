"use client";

import { useEffect, useRef } from "react";
import { Side } from "@blindspot/sdk";
import type { Hex } from "viem";
import { SealedChip, SideBadge } from "@/components/bits";
import { fingerprint, fmtAmount, shortAddr, sym } from "@/lib/format";
import type { BetRow } from "@/lib/hooks";
import { receiptFor } from "@/lib/receipts";

/**
 * Every bet in the market. Everyone sees amounts; sides stay as sealed chips until the
 * reveal — except your own, which this browser knows from your receipt.
 */
export function BlindTape({ bets, me }: { bets: BetRow[]; me: Hex | null }) {
  // remember which bets we've already shown revealed so only fresh reveals animate
  const seen = useRef(new Set<string>());
  const fresh = new Set<string>();
  for (const b of bets) {
    const k = b.betId.toString();
    if (b.side !== Side.Hidden && !seen.current.has(k)) fresh.add(k);
  }
  useEffect(() => {
    for (const b of bets) if (b.side !== Side.Hidden) seen.current.add(b.betId.toString());
  });

  if (bets.length === 0) {
    return <p className="py-6 text-[14px] text-white/40">No bets yet. The first call is always blind.</p>;
  }

  return (
    <div className="divide-y divide-white/[0.06]">
      {[...bets].reverse().map((b) => {
        const mine = !!me && b.bettor.toLowerCase() === me.toLowerCase();
        const receipt = mine ? receiptFor(b.marketId, b.betId, me) : undefined;
        return (
          <div key={b.betId.toString()} className="grid grid-cols-[44px_1fr_auto_auto] items-center gap-4 py-3 text-[13px]">
            <span className="mono text-white/30">#{b.betId.toString()}</span>
            <span className="truncate">
              <span className="mono text-white/70">{shortAddr(b.bettor)}</span>
              {mine && <span className="ml-2 text-[11px] text-[#b9abff]">you</span>}
              <span className="mono ml-3 hidden text-[11px] text-white/25 sm:inline" title="ML-KEM-1024 sealed payload">
                {fingerprint(b.sealedSide)}
              </span>
            </span>
            <span className="text-right font-medium text-white/90">
              {fmtAmount(b.amount)} <span className="text-white/35">{sym()}</span>
            </span>
            <span className="flex justify-end">
              {b.side !== Side.Hidden ? (
                <SideBadge side={b.side} animate={fresh.has(b.betId.toString())} you={mine} />
              ) : receipt ? (
                <span className="flex items-center gap-2" title="Only you can see this — it’s still sealed on-chain">
                  <span className="text-[11px] text-white/35">{receipt.side === Side.Yes ? "Yes" : "No"} · only you</span>
                  <SealedChip />
                </span>
              ) : (
                <SealedChip />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
