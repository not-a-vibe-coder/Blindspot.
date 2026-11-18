"use client";

import Link from "next/link";
import { useState } from "react";
import { Side } from "@blindspot/sdk";
import type { Hex } from "viem";
import { Glass } from "@/components/Glass";
import { Notice, PhaseChip, SealedChip, SideBadge, Spinner, Stat } from "@/components/bits";
import { useWallet } from "@/lib/wallet";
import { useChainNow, useMarkets, usePoll, useReceipts } from "@/lib/hooks";
import { useTx } from "@/lib/useTx";
import { downloadReceipt, importReceipts, receiptFor } from "@/lib/receipts";
import { fmtAmount, sym } from "@/lib/format";
import { phaseOf, type MarketView } from "@/lib/market";
import { configured } from "@/lib/config";

interface MyBet {
  m: MarketView;
  betId: bigint;
  amount: bigint;
  side: Side;
  claimed: boolean;
  payout: bigint;
}

export default function PortfolioPage() {
  const { address, connect, reader, writer } = useWallet();
  const markets = useMarkets();
  const now = useChainNow();
  const receipts = useReceipts(address);
  const tx = useTx();
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const mine = usePoll(
    async () => {
      if (!address || !markets.data || !configured) return { bets: [] as MyBet[], credits: 0n };
      const r = reader.read();
      const lists = await Promise.all(
        markets.data.map(async (m) => {
          const sealed = await reader.getSealedBets(m.info.marketId, m.info.createdAtBlock);
          const own = sealed.filter((b) => b.bettor.toLowerCase() === address.toLowerCase());
          return Promise.all(
            own.map(async (b) => {
              const [onchain, [payout]] = await Promise.all([r.bet(m.info.marketId, b.betId), r.previewPayout(m.info.marketId, b.betId)]);
              return { m, betId: b.betId, amount: b.amount, side: onchain.side as Side, claimed: onchain.claimed, payout } satisfies MyBet;
            }),
          );
        }),
      );
      const credits = await r.credits(address as Hex);
      return { bets: lists.flat(), credits };
    },
    [address, markets.data, reader],
    10_000,
  );

  if (!address) {
    return (
      <Glass className="fly-in px-7 py-12 sm:px-12">
        <p className="eyebrow">Portfolio</p>
        <h1 className="headline mt-5 text-[clamp(40px,5vw,80px)]">Your blind calls.</h1>
        <p className="mt-5 max-w-lg text-white/55">Connect a wallet to see your sealed bets, reveal them, and claim what you won.</p>
        <button type="button" className="pill mt-8" onClick={() => void connect()}>
          Connect wallet
        </button>
      </Glass>
    );
  }

  const bets = mine.data?.bets ?? [];
  const staked = bets.reduce((a, b) => a + b.amount, 0n);
  const claimable = bets.filter((b) => !b.claimed && b.payout > 0n);
  const claimableTotal = claimable.reduce((a, b) => a + b.payout, 0n);
  const open = bets.filter((b) => phaseOf(b.m, now) === "open").length;
  const refresh = () => {
    void markets.refresh();
    void mine.refresh();
  };

  return (
    <>
      <Glass className="fly-in px-7 py-10 sm:px-12">
        <p className="eyebrow">Portfolio</p>
        <h1 className="headline mt-5 text-[clamp(40px,5vw,80px)]">Your blind calls.</h1>
        <div className="mt-10 grid grid-cols-2 gap-8 sm:grid-cols-4">
          <Stat label="Staked" value={<>{fmtAmount(staked)} <span className="text-base text-white/40">{sym()}</span></>} sub={`${bets.length} bets`} />
          <Stat label="Still sealed" value={open} sub="markets open" />
          <Stat
            label="Claimable"
            value={<span className={claimableTotal > 0n ? "text-[#36d67e]" : ""}>{fmtAmount(claimableTotal)}</span>}
            sub={`${claimable.length} bets`}
          />
          <Stat label="Bond credits" value={fmtAmount(mine.data?.credits ?? 0n)} sub={sym()} />
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          {(mine.data?.credits ?? 0n) > 0n && (
            <button type="button" className="pill" disabled={!!tx.pending || !writer} onClick={() => void tx.run("Withdrawing credits", () => writer!.withdrawCredits(), refresh)}>
              Withdraw credits
            </button>
          )}
          <label className="pill pill-ghost cursor-pointer">
            Import receipt
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  setImportMsg(`Imported ${importReceipts(await f.text())} receipt(s).`);
                } catch (err) {
                  setImportMsg((err as Error).message);
                }
              }}
            />
          </label>
          {receipts.length > 0 && (
            <button type="button" className="pill pill-ghost" onClick={() => receipts.forEach((r) => downloadReceipt(r))}>
              Download receipts ({receipts.length})
            </button>
          )}
        </div>
        <div className="mt-3 max-w-lg space-y-2">
          {importMsg && <Notice>{importMsg}</Notice>}
          {tx.error && <Notice tone="error">{tx.error}</Notice>}
        </div>
      </Glass>

      <Glass className="fly-in p-6 sm:p-8" style={{ animationDelay: "60ms" }}>
        <p className="eyebrow">Bets</p>
        {mine.loading && !mine.data ? (
          <div className="flex items-center gap-3 py-8 text-white/50">
            <Spinner /> Reading your bets…
          </div>
        ) : bets.length === 0 ? (
          <p className="py-8 text-white/45">
            No bets from this wallet yet.{" "}
            <Link href="/markets" className="link">
              Find a market →
            </Link>
          </p>
        ) : (
          <div className="mt-3 divide-y divide-white/[0.06]">
            {[...bets]
              .sort((a, b) => Number(b.m.info.marketId - a.m.info.marketId) || Number(b.betId - a.betId))
              .map((b) => (
                <BetRowView key={`${b.m.info.marketId}-${b.betId}`} b={b} me={address} now={now} tx={tx} refresh={refresh} />
              ))}
          </div>
        )}
      </Glass>
    </>
  );
}

function BetRowView({ b, me, now, tx, refresh }: { b: MyBet; me: Hex; now: bigint; tx: ReturnType<typeof useTx>; refresh: () => void }) {
  const { writer } = useWallet();
  const phase = phaseOf(b.m, now);
  const receipt = receiptFor(b.m.info.marketId, b.betId, me);
  const canReveal = phase === "unsealing" && b.side === Side.Hidden && !!receipt;
  const claimsOpen = now >= b.m.info.revealDeadline;

  let status: React.ReactNode;
  if (b.claimed) status = <span className="text-white/40">Claimed</span>;
  else if (canReveal)
    status = (
      <button
        type="button"
        className="pill h-8 px-3 text-[12px]"
        disabled={!!tx.pending || !writer}
        onClick={() => void tx.run("Revealing", () => writer!.selfReveal(receipt!), refresh)}
      >
        Reveal
      </button>
    );
  else if (claimsOpen && b.payout > 0n)
    status = (
      <button
        type="button"
        className="pill h-8 px-3 text-[12px]"
        disabled={!!tx.pending || !writer}
        onClick={() => void tx.run("Claiming", () => writer!.claim(b.m.info.marketId, b.betId), refresh)}
      >
        Claim {fmtAmount(b.payout)}
      </button>
    );
  else if (phase === "settled" && claimsOpen) status = <span className="text-white/35">{b.side === Side.Hidden ? "Forfeited" : "Lost"}</span>;
  else if (phase === "awaiting" && !b.m.keyReleased) status = <span className="text-white/40">Refund pending</span>;
  else status = <span className="text-white/40">{phase === "open" ? "Sealed" : phase === "unsealing" ? "Unsealing" : "Awaiting outcome"}</span>;

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-4 py-4 sm:grid-cols-[1fr_auto_auto_auto]">
      <div className="min-w-0">
        <Link href={`/markets/${b.m.info.marketId}`} className="block truncate text-[14px] font-medium text-white hover:text-[#b9abff]">
          {b.m.info.question}
        </Link>
        <div className="mt-1.5 flex items-center gap-3">
          <PhaseChip phase={phase} />
          <span className="mono text-[11px] text-white/30">
            #{b.m.info.marketId.toString()} · bet {b.betId.toString()}
          </span>
        </div>
      </div>
      <span className="hidden text-right text-[14px] sm:block">
        {fmtAmount(b.amount)} <span className="text-white/35">{sym()}</span>
      </span>
      <span className="hidden justify-end sm:flex">
        {b.side !== Side.Hidden ? (
          <SideBadge side={b.side} />
        ) : receipt ? (
          <span className="flex items-center gap-2 text-[11px] text-white/40">
            {receipt.side === Side.Yes ? "Yes" : "No"} · only you <SealedChip />
          </span>
        ) : (
          <SealedChip />
        )}
      </span>
      <span className="flex justify-end text-[12px]">{status}</span>
    </div>
  );
}
