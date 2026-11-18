"use client";

import Link from "next/link";
import { Outcome } from "@blindspot/sdk";
import { Glass } from "@/components/Glass";
import { PhaseChip, SealedChip, Spinner } from "@/components/bits";
import { useChainNow, useMarkets } from "@/lib/hooks";
import { configured, config } from "@/lib/config";
import { countdown, errMsg, fmtAmount, sym } from "@/lib/format";
import { effectiveOutcome, OUTCOME_LABEL, pct, phaseOf, type MarketView } from "@/lib/market";

export default function MarketsPage() {
  const { data, error, loading } = useMarkets();
  const now = useChainNow();

  return (
    <>
      <Glass className="fly-in overflow-hidden px-7 py-10 sm:px-12 sm:py-14">
        <p className="eyebrow">Markets</p>
        <h1 className="headline mt-5 text-[clamp(44px,6vw,92px)]">
          Every side,
          <br />
          sealed.
        </h1>
        <p className="mt-6 max-w-xl text-[16px] leading-[1.55] text-white/55">
          You see how much is in each pool — never which way it leans. Sides unseal together when betting closes, so the only
          signal you can follow is your own.
        </p>
      </Glass>

      {configured && loading && !data && (
        <div className="flex items-center gap-3 px-2 py-10 text-white/50">
          <Spinner /> Reading markets from {config.chain.name}…
        </div>
      )}
      {error && !data && (
        <Glass className="p-6 text-[14px] text-[#ff8a9a]">Couldn’t reach the chain: {errMsg(error)}</Glass>
      )}
      {data && data.length === 0 && (
        <Glass className="p-8 text-white/60">
          No markets yet. Markets are opened by a keyper (it holds each market’s sealing key):{" "}
          <code className="mono text-white">pnpm keyper create-market</code>
        </Glass>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-3">
          {data.map((m, i) => (
            <MarketCard key={m.info.marketId.toString()} m={m} now={now} index={i} />
          ))}
        </div>
      )}
    </>
  );
}

function MarketCard({ m, now, index }: { m: MarketView; now: bigint; index: number }) {
  const phase = phaseOf(m, now);
  const outcome = effectiveOutcome(m, now);
  const revealed = m.pool.revealedCount > 0;
  const revealedTotal = m.pool.revealedYes + m.pool.revealedNo;

  return (
    <Link href={`/markets/${m.info.marketId}`} className="block" style={{ animationDelay: `${index * 45}ms` }}>
      <Glass interactive className="fly-in flex h-full min-h-[260px] flex-col justify-between p-6" style={{ animationDelay: `${index * 45}ms` }}>
        <div>
          <div className="flex items-center justify-between">
            <PhaseChip phase={phase} />
            <span className="mono text-[11px] text-white/30">#{m.info.marketId.toString()}</span>
          </div>
          <h2 className="mt-5 text-[20px] font-medium leading-[1.25] tracking-[-0.02em] text-white">{m.info.question}</h2>
        </div>

        <div className="mt-8">
          {revealed ? (
            <div>
              <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
                <div className="h-full bg-[#36d67e]" style={{ width: `${pct(m.pool.revealedYes, revealedTotal)}%` }} />
                <div className="h-full bg-[#b9abff]" style={{ width: `${pct(m.pool.revealedNo, revealedTotal)}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[12px]">
                <span className="text-[#36d67e]">Yes {pct(m.pool.revealedYes, revealedTotal).toFixed(0)}%</span>
                <span className="text-[#b9abff]">No {pct(m.pool.revealedNo, revealedTotal).toFixed(0)}%</span>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5">
              {Array.from({ length: Math.min(m.pool.betCount, 8) }).map((_, i) => (
                <SealedChip key={i} className="!w-7" />
              ))}
              {m.pool.betCount === 0 && <span className="text-[12px] text-white/35">No bets yet — be the first blind call.</span>}
            </div>
          )}

          <div className="mt-5 flex items-end justify-between">
            <div>
              <p className="eyebrow">Blind pool</p>
              <p className="mt-1.5 text-[26px] font-medium tracking-[-0.03em]">
                {fmtAmount(m.pool.totalStaked)} <span className="text-[14px] text-white/40">{sym()}</span>
              </p>
            </div>
            <div className="text-right text-[12px] text-white/45">
              <p>{m.pool.betCount} bets</p>
              <p className="mt-0.5 text-white/70">
                {phase === "open" && `Closes in ${countdown(m.info.closeTime - now)}`}
                {phase === "unsealing" && `Unsealing · ${countdown(m.info.revealDeadline - now)}`}
                {phase === "awaiting" && "Awaiting outcome"}
                {phase === "settled" && (
                  <span style={{ color: outcome === Outcome.Yes ? "#36d67e" : outcome === Outcome.No ? "#b9abff" : undefined }}>
                    Resolved {OUTCOME_LABEL[outcome]}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </Glass>
    </Link>
  );
}
