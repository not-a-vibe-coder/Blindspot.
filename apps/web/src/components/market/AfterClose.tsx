"use client";

import { useEffect, useState } from "react";
import { Outcome, Side } from "@blindspot/sdk";
import type { Hex } from "viem";
import { Glass } from "@/components/Glass";
import { Notice, SideBadge, Spinner } from "@/components/bits";
import { useWallet } from "@/lib/wallet";
import { useTx } from "@/lib/useTx";
import { importReceipts, receiptFor } from "@/lib/receipts";
import { countdown, fmtAmount, shortAddr, sym } from "@/lib/format";
import { effectiveOutcome, isRefund, LIVENESS, OUTCOME_LABEL, phaseOf, ZERO, type MarketView } from "@/lib/market";
import type { BetRow } from "@/lib/hooks";

type Props = { m: MarketView; bets: BetRow[]; now: bigint; refresh: () => void };

const outcomeColor = (o: number) => (o === Outcome.Yes ? "#36d67e" : o === Outcome.No ? "#b9abff" : "rgba(255,255,255,0.8)");

/** Keyper status + self-reveal for your still-sealed bets. */
export function RevealPanel({ m, bets, now, refresh }: Props) {
  const { address, writer } = useWallet();
  const tx = useTx();
  const mine = address ? bets.filter((b) => b.bettor.toLowerCase() === address.toLowerCase()) : [];
  const hidden = mine.filter((b) => b.side === Side.Hidden);
  const inWindow = now >= m.info.closeTime && now < m.info.revealDeadline;

  const revealAll = async () => {
    if (!writer || !address) return;
    const reveals = hidden
      .map((b) => receiptFor(m.info.marketId, b.betId, address))
      .filter((r): r is NonNullable<typeof r> => !!r && r.betId !== undefined)
      .map((r) => ({ betId: r.betId!, side: r.side, salt: r.salt }));
    if (reveals.length === 0) return;
    await tx.run("Revealing your side", () => writer.revealBets(m.info.marketId, reveals), refresh);
  };
  const withReceipt = hidden.filter((b) => receiptFor(m.info.marketId, b.betId, address));

  return (
    <Glass className="p-6">
      <p className="eyebrow">Unsealing</p>
      <h3 className="title mt-3 text-[20px]">{m.keyReleased ? "The key is public." : "Waiting for the keyper…"}</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-white/50">
        {m.keyReleased
          ? "Anyone can now decrypt every sealed side and check it against its commitment. The keyper is revealing them in batches."
          : "Betting has closed. The keyper publishes this market’s ML-KEM-1024 secret key on-chain, then reveals every bet."}
      </p>
      <div className="mt-5 flex items-baseline justify-between text-[13px]">
        <span className="text-white/50">Revealed</span>
        <span className="font-medium">
          {m.pool.revealedCount} / {m.pool.betCount}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full bg-[#b9abff] transition-all" style={{ width: `${m.pool.betCount ? (m.pool.revealedCount / m.pool.betCount) * 100 : 0}%` }} />
      </div>
      {inWindow && (
        <p className="mt-2 text-[11px] text-white/35">Reveal window closes in {countdown(m.info.revealDeadline - now)} — unrevealed bets are forfeited.</p>
      )}

      {withReceipt.length > 0 && inWindow && (
        <div className="mt-5">
          <button type="button" className="pill w-full" disabled={!!tx.pending} onClick={() => void revealAll()}>
            {tx.pending ? <Spinner /> : null} Reveal my {withReceipt.length > 1 ? `${withReceipt.length} bets` : "bet"} myself
          </button>
          <p className="mt-2 text-[11px] text-white/35">Optional — the keyper does this for you. Uses the receipt saved in this browser.</p>
        </div>
      )}
      {hidden.length > withReceipt.length && inWindow && <ImportReceipt />}
      <div className="mt-3 space-y-2">
        {tx.error && <Notice tone="error">{tx.error}</Notice>}
        {tx.done && <Notice tone="ok">Revealed.</Notice>}
      </div>
    </Glass>
  );
}

function ImportReceipt() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <label className="mt-4 block cursor-pointer text-[12px] text-white/50 hover:text-white">
      <input
        type="file"
        accept="application/json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            setMsg(`Imported ${importReceipts(await f.text())} receipt(s).`);
          } catch (err) {
            setMsg((err as Error).message);
          }
        }}
      />
      Have a bet without a receipt here? <span className="underline underline-offset-4">Import receipt</span>
      {msg && <span className="mt-1 block text-white/60">{msg}</span>}
    </label>
  );
}

/** UMA-style optimistic oracle: propose with a bond, dispute within 2h, finalize. */
export function OraclePanel({ m, now, refresh }: Props) {
  const { writer, address, connect } = useWallet();
  const tx = useTx();
  const [pick, setPick] = useState<Outcome.Yes | Outcome.No | Outcome.Invalid>(Outcome.Yes);
  const [bond, setBond] = useState<bigint | null>(null);
  const { reader } = useWallet();
  useEffect(() => {
    reader.read().proposalBond().then(setBond).catch(() => {});
  }, [reader]);

  const p = m.proposal;
  const hasProposal = p.proposer !== ZERO;
  const disputed = p.disputer !== ZERO;
  const livenessEnd = p.proposedAt + LIVENESS;
  const canPropose = !hasProposal && now >= m.info.closeTime && now + LIVENESS <= m.info.resolveDeadline;
  const expired = now >= m.info.resolveDeadline;

  const act = (label: string, fn: (w: NonNullable<typeof writer>) => Promise<unknown>) =>
    writer ? tx.run(label, () => fn(writer), refresh) : connect();

  const keyLost = !m.keyReleased && now >= m.info.revealDeadline;

  return (
    <Glass className="p-6">
      <p className="eyebrow">Outcome</p>
      {keyLost && (
        <div className="mt-3">
          <Notice>
            The keyper never released this market’s key, so no side can be revealed: every stake is refunded once any outcome is
            final. Proposing an outcome (or waiting for the resolve deadline) unlocks the refunds.
          </Notice>
        </div>
      )}
      {!hasProposal && !expired && (
        <>
          <h3 className="title mt-3 text-[20px]">Nobody has called it yet.</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/50">
            Propose the outcome by posting a {bond !== null ? `${fmtAmount(bond)} ${sym()}` : ""} bond. If nobody disputes it within
            two hours it’s final and your bond comes back.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {([Outcome.Yes, Outcome.No, Outcome.Invalid] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setPick(o)}
                className="h-10 rounded-[10px] text-[13px] font-medium transition-colors"
                style={{
                  color: pick === o ? outcomeColor(o) : "rgba(255,255,255,0.6)",
                  boxShadow: `inset 0 0 0 1px ${pick === o ? outcomeColor(o) : "rgba(255,255,255,0.08)"}`,
                }}
              >
                {OUTCOME_LABEL[o]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pill mt-4 w-full"
            disabled={!canPropose || !!tx.pending}
            onClick={() => void act("Proposing outcome", (w) => w.proposeOutcome(m.info.marketId, pick))}
          >
            {tx.pending ? <Spinner /> : null} {address ? `Propose ${OUTCOME_LABEL[pick]}` : "Connect to propose"}
          </button>
          {!canPropose && now + LIVENESS > m.info.resolveDeadline && (
            <p className="mt-2 text-[11px] text-white/35">Too close to the resolve deadline for a new proposal.</p>
          )}
        </>
      )}

      {hasProposal && !disputed && (
        <>
          <h3 className="title mt-3 text-[20px]">
            Proposed: <span style={{ color: outcomeColor(p.outcome) }}>{OUTCOME_LABEL[p.outcome]}</span>
          </h3>
          <p className="mt-2 text-[13px] text-white/50">
            by <span className="mono">{shortAddr(p.proposer)}</span> · bond {fmtAmount(p.bond)} {sym()}
          </p>
          {now < livenessEnd ? (
            <>
              <p className="mt-4 text-[13px] text-white/70">Final in {countdown(livenessEnd - now)} unless disputed.</p>
              <button
                type="button"
                className="pill pill-ghost mt-4 w-full"
                disabled={!!tx.pending}
                onClick={() => void act("Disputing", (w) => w.disputeOutcome(m.info.marketId))}
              >
                {tx.pending ? <Spinner /> : null} Dispute — match the {fmtAmount(p.bond)} {sym()} bond
              </button>
              <p className="mt-2 text-[11px] text-white/35">A dispute goes to the post-quantum council; whoever it agrees with takes both bonds.</p>
            </>
          ) : (
            <button type="button" className="pill mt-4 w-full" disabled={!!tx.pending} onClick={() => void act("Finalizing", (w) => w.settle(m.info.marketId))}>
              {tx.pending ? <Spinner /> : null} Finalize outcome
            </button>
          )}
        </>
      )}

      {hasProposal && disputed && (
        <>
          <h3 className="title mt-3 text-[20px]">Disputed — with the council.</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/50">
            <span className="mono">{shortAddr(p.proposer)}</span> said {OUTCOME_LABEL[p.outcome]};{" "}
            <span className="mono">{shortAddr(p.disputer)}</span> disagreed. The council resolves it with an ML-DSA-87 signature,
            verified on-chain by QoreChain’s post-quantum precompile.
          </p>
        </>
      )}

      {expired && (
        <>
          <h3 className="title mt-3 text-[20px]">No outcome in time.</h3>
          <p className="mt-2 text-[13px] text-white/50">The resolve deadline passed — the market settles as Invalid and everyone is refunded.</p>
          <button type="button" className="pill mt-4 w-full" disabled={!!tx.pending} onClick={() => void act("Settling", (w) => w.settle(m.info.marketId))}>
            {tx.pending ? <Spinner /> : null} Settle as Invalid
          </button>
        </>
      )}
      <div className="mt-3 space-y-2">{tx.error && <Notice tone="error">{tx.error}</Notice>}</div>
    </Glass>
  );
}

/** Final outcome + your bets with payouts and claims. */
export function ClaimPanel({ m, bets, now, refresh }: Props) {
  const { address, writer, reader, connect } = useWallet();
  const tx = useTx();
  const outcome = effectiveOutcome(m, now);
  const refund = isRefund(m, now);
  const claimsOpen = now >= m.info.revealDeadline;
  const mine = address ? bets.filter((b) => b.bettor.toLowerCase() === address.toLowerCase()) : [];
  const [payouts, setPayouts] = useState<Record<string, bigint>>({});
  const [credits, setCredits] = useState(0n);

  useEffect(() => {
    if (!address || !claimsOpen) return;
    let alive = true;
    void Promise.all(mine.map(async (b) => [b.betId.toString(), (await reader.read().previewPayout(m.info.marketId, b.betId))[0]] as const)).then(
      (rows) => alive && setPayouts(Object.fromEntries(rows)),
    );
    void reader.read().credits(address as Hex).then((c) => alive && setCredits(c));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, claimsOpen, bets, m.resolution.outcome, reader]);

  return (
    <Glass className="p-6">
      <p className="eyebrow">Settled</p>
      <h3 className="mt-3 text-[30px] font-medium tracking-[-0.03em]" style={{ color: outcomeColor(outcome) }}>
        {outcome === Outcome.Invalid ? "Invalid" : `Resolved ${OUTCOME_LABEL[outcome]}`}
      </h3>
      <p className="mt-2 text-[13px] text-white/50">
        {m.resolution.outcome !== Outcome.Unresolved && m.resolution.viaCouncil
          ? "Signed by the council with ML-DSA-87, verified on-chain."
          : m.resolution.outcome !== Outcome.Unresolved
            ? "Finalized by the optimistic oracle (undisputed)."
            : "Final — claims settle it on-chain on the way."}
        {refund && " Refund mode: every stake is returned."}
      </p>

      {!address ? (
        <button type="button" className="pill mt-5 w-full" onClick={() => void connect()}>
          Connect to see your bets
        </button>
      ) : mine.length === 0 ? (
        <p className="mt-5 text-[13px] text-white/40">You didn’t bet on this market.</p>
      ) : (
        <div className="mt-5 space-y-2">
          {mine.map((b) => {
            const payout = payouts[b.betId.toString()];
            return (
              <div key={b.betId.toString()} className="flex items-center justify-between gap-3 rounded-[12px] bg-black/25 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
                <div className="flex items-center gap-3">
                  <SideBadge side={b.side} />
                  <span className="text-[13px] text-white/70">
                    {fmtAmount(b.amount)} {sym()}
                  </span>
                </div>
                {b.claimed ? (
                  <span className="text-[12px] text-white/40">Claimed</span>
                ) : !claimsOpen ? (
                  <span className="text-[12px] text-white/40">Claims open after reveals</span>
                ) : payout === undefined ? (
                  <Spinner />
                ) : payout > 0n ? (
                  <button
                    type="button"
                    className="pill h-8 px-3 text-[12px]"
                    disabled={!!tx.pending || !writer}
                    onClick={() => void tx.run("Claiming", () => writer!.claim(m.info.marketId, b.betId), refresh)}
                  >
                    Claim {fmtAmount(payout)}
                  </button>
                ) : (
                  <span className="text-[12px] text-white/35">{b.side === Side.Hidden ? "Forfeited" : "Lost"}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {credits > 0n && (
        <div className="mt-5 flex items-center justify-between rounded-[12px] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <span className="text-[13px] text-white/70">
            Bond credits: {fmtAmount(credits)} {sym()}
          </span>
          <button type="button" className="pill pill-ghost h-8 px-3 text-[12px]" disabled={!!tx.pending || !writer} onClick={() => void tx.run("Withdrawing", () => writer!.withdrawCredits(), refresh)}>
            Withdraw
          </button>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {tx.pending && <Notice>{tx.pending}…</Notice>}
        {tx.error && <Notice tone="error">{tx.error}</Notice>}
      </div>
    </Glass>
  );
}

export { phaseOf };
