import { Outcome, type MarketInfo } from "@blindspot/sdk";

export const ZERO = "0x0000000000000000000000000000000000000000";
export const LIVENESS = 2n * 3600n; // BlindspotMarkets.LIVENESS

export interface Pool {
  totalStaked: bigint;
  revealedYes: bigint;
  revealedNo: bigint;
  betCount: number;
  revealedCount: number;
}

export interface Proposal {
  outcome: number;
  proposer: `0x${string}`;
  proposedAt: bigint;
  disputer: `0x${string}`;
  bond: bigint;
}

export interface Resolution {
  outcome: number;
  viaCouncil: boolean;
}

export interface MarketView {
  info: MarketInfo;
  pool: Pool;
  resolution: Resolution;
  proposal: Proposal;
  keyReleased: boolean;
}

/**
 *  open       betting; sides sealed
 *  unsealing  closed; keyper releases the key, sides are revealed
 *  awaiting   reveal window over; waiting for the outcome (proposal / council)
 *  settled    final outcome known; claims open
 */
export type Phase = "open" | "unsealing" | "awaiting" | "settled";

/** Mirrors BlindspotMarkets._effectiveOutcome. */
export function effectiveOutcome(m: MarketView, now: bigint): Outcome {
  if (m.resolution.outcome !== Outcome.Unresolved) return m.resolution.outcome;
  const p = m.proposal;
  if (p.proposer !== ZERO && p.disputer === ZERO && now >= p.proposedAt + LIVENESS) return p.outcome;
  if (now >= m.info.resolveDeadline) return Outcome.Invalid;
  return Outcome.Unresolved;
}

export function phaseOf(m: MarketView, now: bigint): Phase {
  if (now < m.info.closeTime) return "open";
  if (now < m.info.revealDeadline) return "unsealing";
  return effectiveOutcome(m, now) === Outcome.Unresolved ? "awaiting" : "settled";
}

export const PHASE_LABEL: Record<Phase, string> = {
  open: "Open · sealed",
  unsealing: "Unsealing",
  awaiting: "Awaiting outcome",
  settled: "Settled",
};

/** Refund mode, as the contract computes it in _settlement. */
export function isRefund(m: MarketView, now: bigint): boolean {
  const o = effectiveOutcome(m, now);
  if (o === Outcome.Invalid) return true;
  if (!m.keyReleased) return true;
  const winning = o === Outcome.Yes ? m.pool.revealedYes : o === Outcome.No ? m.pool.revealedNo : 0n;
  return o !== Outcome.Unresolved && winning === 0n;
}

export const OUTCOME_LABEL: Record<number, string> = {
  [Outcome.Unresolved]: "Unresolved",
  [Outcome.Yes]: "Yes",
  [Outcome.No]: "No",
  [Outcome.Invalid]: "Invalid",
};

export function pct(part: bigint, total: bigint): number {
  return total === 0n ? 0 : Number((part * 10_000n) / total) / 100;
}
