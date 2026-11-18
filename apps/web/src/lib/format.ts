import { formatEther, type Hex } from "viem";
import { config } from "./config";

export function fmtAmount(wei: bigint | undefined, digits = 3): string {
  if (wei === undefined) return "—";
  const n = Number(formatEther(wei));
  if (n === 0) return "0";
  if (n < 0.001) return "<0.001";
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 1 : digits });
}

export const sym = () => config.symbol;

export function shortAddr(a?: string | null): string {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** "2d 4h", "3h 12m", "12m 05s", "now" */
export function countdown(seconds: bigint | number): string {
  let s = Math.max(0, Math.floor(Number(seconds)));
  if (s <= 0) return "now";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function dateTime(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** short visual fingerprint of a sealed payload */
export function fingerprint(hex: Hex): string {
  return `${hex.slice(2, 6)}·${hex.slice(-4)}`;
}

export function txUrl(hash: string): string | undefined {
  return config.explorer ? `${config.explorer}/tx/${hash}` : undefined;
}

/** Contract custom errors → plain English. */
const REVERTS: Record<string, string> = {
  BettingClosed: "Betting has closed on this market.",
  BetTooSmall: "Minimum bet is 0.001.",
  InvalidSealedSide: "The sealed payload was rejected.",
  InvalidCommitment: "Invalid commitment.",
  UnknownMarket: "That market doesn’t exist.",
  UnknownBet: "That bet doesn’t exist.",
  NotInRevealWindow: "Reveals are only open between close and the reveal deadline.",
  KeyAlreadyReleased: "The sealer key is already public.",
  WrongSealerKey: "That isn’t this market’s sealer key.",
  InvalidReveal: "That side/salt doesn’t match the commitment.",
  MarketStillOpen: "The market hasn’t closed yet.",
  AlreadyResolved: "The market is already resolved.",
  ResolutionExpired: "Too close to the resolve deadline.",
  InvalidOutcome: "Pick Yes, No or Invalid.",
  WrongCouncilKey: "Wrong council key.",
  BadCouncilSignature: "The council signature didn’t verify.",
  ProposalExists: "An outcome has already been proposed.",
  NoProposal: "Nothing has been proposed yet.",
  AlreadyDisputed: "This proposal is already disputed.",
  LivenessOver: "The dispute window has closed.",
  WrongBond: "Send exactly the bond amount.",
  NotSettleable: "Not settleable yet — waiting on the dispute window or the council.",
  NothingToWithdraw: "Nothing to withdraw.",
  RevealsStillOpen: "Claims open when the reveal window ends.",
  AlreadyClaimed: "Already claimed.",
  NotAWinner: "This bet didn’t win.",
  NoFees: "No fees to collect.",
  PQCPrecompileUnavailable: "The post-quantum verifier isn’t available on this chain.",
};

export function errMsg(e: unknown): string {
  // walk viem's cause chain for a decoded custom error
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur; i++) {
    const c = cur as { data?: { errorName?: string }; cause?: unknown };
    const name = c.data?.errorName;
    if (name) return REVERTS[name] ?? name;
    cur = c.cause;
  }
  const any = e as { shortMessage?: string; message?: string };
  const msg = any?.shortMessage ?? any?.message ?? String(e);
  if (/User (rejected|denied)|rejected the request/i.test(msg)) return "Request rejected in wallet.";
  if (/insufficient funds/i.test(msg)) return "Not enough balance for this transaction.";
  return msg.split("\n")[0]!.slice(0, 220);
}
