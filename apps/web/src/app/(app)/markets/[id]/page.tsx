"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Outcome } from "@blindspot/sdk";
import { Glass } from "@/components/Glass";
import { PhaseChip, SealedChip, Spinner, Stat } from "@/components/bits";
import { Timeline } from "@/components/market/Timeline";
import { BlindTape } from "@/components/market/BlindTape";
import { BetPanel } from "@/components/market/BetPanel";
import { ClaimPanel, OraclePanel, RevealPanel } from "@/components/market/AfterClose";
import { useChainNow, useMarket } from "@/lib/hooks";
import { useWallet } from "@/lib/wallet";
import { errMsg, fmtAmount, sym } from "@/lib/format";
import { effectiveOutcome, pct, phaseOf } from "@/lib/market";

export default function MarketPage() {
  const params = useParams<{ id: string }>();
  const valid = /^\d+$/.test(params.id ?? "");
  const marketId = valid ? BigInt(params.id) : 0n;
  const { data, error, refresh } = useMarket(marketId);
  const now = useChainNow();
  const { address } = useWallet();

  if (!valid) return <Glass className="p-8 text-white/60">That isn’t a market id.</Glass>;
  if (error && !data) {
    return (
      <Glass className="p-8">
        <p className="text-white/70">{/not found/.test(error.message) ? `Market #${params.id} doesn’t exist.` : errMsg(error)}</p>
        <Link href="/markets" className="link mt-4 inline-block text-sm">
          ← All markets
        </Link>
      </Glass>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-3 px-2 py-16 text-white/50">
        <Spinner /> Unsealing nothing yet — loading market…
      </div>
    );
  }

  const { view: m, bets } = data;
  const phase = phaseOf(m, now);
  const revealedTotal = m.pool.revealedYes + m.pool.revealedNo;
  const outcome = effectiveOutcome(m, now);
  const props = { m, bets, now, refresh: () => void refresh() };

  return (
    <div className="grid items-start gap-[14px] lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-[14px]">
        <Glass className="fly-in p-7 sm:p-10">
          <div className="flex items-center justify-between">
            <Link href="/markets" className="link text-[13px]">
              ← Markets
            </Link>
            <div className="flex items-center gap-3">
              <span className="mono text-[11px] text-white/30">#{m.info.marketId.toString()}</span>
              <PhaseChip phase={phase} />
            </div>
          </div>
          <h1 className="headline mt-8 text-[clamp(30px,3.6vw,54px)] !leading-[1.05]">{m.info.question}</h1>
          <Timeline m={m} now={now} />
        </Glass>

        <Glass className="fly-in p-7 sm:p-8" style={{ animationDelay: "60ms" }}>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            <Stat label="Blind pool" value={<>{fmtAmount(m.pool.totalStaked)} <span className="text-base text-white/40">{sym()}</span></>} />
            <Stat label="Bets" value={m.pool.betCount} sub={m.pool.revealedCount ? `${m.pool.revealedCount} revealed` : "all sealed"} />
            <Stat
              label="Sealer key"
              value={<span className="text-lg">{m.keyReleased ? "Released" : "Held by keyper"}</span>}
              sub="ML-KEM-1024"
            />
          </div>

          <div className="mt-8">
            {revealedTotal > 0n ? (
              <>
                <div className="flex h-3 overflow-hidden rounded-full bg-white/5">
                  <div className="reveal-in h-full bg-[#36d67e]" style={{ width: `${pct(m.pool.revealedYes, revealedTotal)}%` }} />
                  <div className="reveal-in h-full bg-[#b9abff]" style={{ width: `${pct(m.pool.revealedNo, revealedTotal)}%` }} />
                </div>
                <div className="mt-3 flex justify-between text-[13px]">
                  <span className="text-[#36d67e]">
                    Yes · {fmtAmount(m.pool.revealedYes)} {sym()} ({pct(m.pool.revealedYes, revealedTotal).toFixed(1)}%)
                  </span>
                  <span className="text-[#b9abff]">
                    No · {fmtAmount(m.pool.revealedNo)} {sym()} ({pct(m.pool.revealedNo, revealedTotal).toFixed(1)}%)
                  </span>
                </div>
                {phase === "settled" && outcome !== Outcome.Invalid && (
                  <p className="mt-3 text-[12px] text-white/40">Winners split the losing pool pro rata, minus a 2% fee on the losing side.</p>
                )}
              </>
            ) : (
              <div className="flex items-center gap-4 rounded-[12px] bg-black/25 px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
                <SealedChip />
                <p className="text-[13px] leading-relaxed text-white/50">
                  No odds to copy. Every side is sealed until betting closes — the split appears here the moment the keyper
                  releases the key.
                </p>
              </div>
            )}
          </div>
        </Glass>

        <Glass className="fly-in p-7 sm:p-8" style={{ animationDelay: "120ms" }}>
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">The blind tape</p>
            <p className="text-[11px] text-white/30">amounts public · sides sealed</p>
          </div>
          <div className="mt-3">
            <BlindTape bets={bets} me={address} />
          </div>
        </Glass>
      </div>

      <aside className="flex flex-col gap-[14px] lg:sticky lg:top-6">
        {phase === "open" && <BetPanel marketId={m.info.marketId} onPlaced={() => void refresh()} />}
        {phase === "unsealing" && <RevealPanel {...props} />}
        {(phase === "unsealing" || phase === "awaiting") && <OraclePanel {...props} />}
        {phase === "settled" && <ClaimPanel {...props} />}
        <HowItWorks />
      </aside>
    </div>
  );
}

function HowItWorks() {
  return (
    <Glass className="p-6">
      <p className="eyebrow">Why blind</p>
      <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-white/50">
        <li>
          <b className="font-medium text-white/80">Sealed:</b> sides are encrypted with ML-KEM-1024 before they leave your browser.
        </li>
        <li>
          <b className="font-medium text-white/80">Committed:</b> a hash binds your side — nobody can change it after the fact.
        </li>
        <li>
          <b className="font-medium text-white/80">Unsealed together:</b> the keyper’s key goes public at close, so everyone sees the split at once.
        </li>
        <li>
          <b className="font-medium text-white/80">Resolved post-quantum:</b> disputes settle with an ML-DSA-87 council signature.
        </li>
      </ul>
    </Glass>
  );
}
