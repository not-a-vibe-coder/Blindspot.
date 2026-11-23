"use client";

import { useEffect, useState } from "react";
import { parseEther } from "viem";
import { Side, type BetReceipt } from "@blindspot/sdk";
import { Glass } from "@/components/Glass";
import { Notice, SideBadge, Spinner } from "@/components/bits";
import { useWallet } from "@/lib/wallet";
import { useTx } from "@/lib/useTx";
import { downloadReceipt, saveReceipt } from "@/lib/receipts";
import { fmtAmount, sym } from "@/lib/format";
import { publicClient } from "@/lib/config";
import { QuantumAccountSetup, useQuantumState } from "@/components/QuantumAccount";

const PRESETS = ["0.1", "0.5", "1", "5"];

export function BetPanel({ marketId, onPlaced }: { marketId: bigint; onPlaced: () => void }) {
  const { writer, address, connect, wrongChain, switchChain, kind, quantum } = useWallet();
  const q = useQuantumState();
  // on QoreChain a Blindspot account must be funded, activated and have an open session
  const needsQuantumSetup = quantum.supported && (kind === null || (kind === "quantum" && !q.ready));
  const [side, setSide] = useState<Side.Yes | Side.No | null>(null);
  const [amount, setAmount] = useState("0.5");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [receipt, setReceipt] = useState<BetReceipt | null>(null);
  const [placed, setPlaced] = useState(0n);
  const tx = useTx();

  useEffect(() => {
    if (!address) return setBalance(null);
    let alive = true;
    const load = () => publicClient().getBalance({ address }).then((b) => alive && setBalance(b)).catch(() => {});
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address, receipt]);

  let wei: bigint | null = null;
  try {
    wei = amount.trim() ? parseEther(amount.trim() as `${number}`) : null;
  } catch {
    wei = null;
  }
  const tooSmall = wei !== null && wei < parseEther("0.001");
  const tooBig = wei !== null && balance !== null && wei > balance;
  const canBet = !!writer && side !== null && wei !== null && !tooSmall && !tooBig && !tx.pending;

  const place = async () => {
    if (!writer || side === null || wei === null) return;
    const res = await tx.run("Sealing with ML-KEM-1024 — confirm in your wallet", () =>
      writer.placeSealedBet({ marketId, side, amount: wei! }),
    );
    if (res) {
      saveReceipt(res.receipt);
      setPlaced(wei);
      setReceipt(res.receipt);
      onPlaced();
    }
  };

  if (receipt) {
    return (
      <Glass className="fly-in p-6">
        <p className="eyebrow">Sealed</p>
        <h3 className="title mt-3 text-[22px]">Only you know your side.</h3>
        <div className="mt-5 flex items-center justify-between rounded-[12px] bg-black/30 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
          <div>
            <p className="text-[12px] text-white/45">Bet #{receipt.betId?.toString()}</p>
            <p className="mt-0.5 font-medium">
              {fmtAmount(placed)} {sym()}
            </p>
          </div>
          <SideBadge side={receipt.side} />
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-white/50">
          On-chain it’s a sealed chip like every other bet. Your receipt (salt + side) is saved in this browser — download a copy so
          you can reveal it yourself if the keyper ever goes dark.
        </p>
        <div className="mt-5 flex gap-3">
          <button type="button" className="pill flex-1" onClick={() => downloadReceipt(receipt)}>
            Download receipt
          </button>
          <button type="button" className="pill pill-ghost" onClick={() => (setReceipt(null), tx.clear())}>
            Bet again
          </button>
        </div>
      </Glass>
    );
  }

  return (
    <Glass className="p-6">
      <p className="eyebrow">Place a blind bet</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {([Side.Yes, Side.No] as const).map((s) => {
          const on = side === s;
          const yes = s === Side.Yes;
          const c = yes ? "54,214,126" : "185,171,255";
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className="h-[72px] rounded-[14px] text-[17px] font-semibold tracking-[-0.01em] transition-all duration-200"
              style={{
                color: on ? (yes ? "#36d67e" : "#b9abff") : "rgba(255,255,255,0.75)",
                background: on ? `rgba(${c},0.12)` : "rgba(255,255,255,0.03)",
                boxShadow: on
                  ? `inset 0 0 0 1px rgba(${c},0.55), 0 0 28px -6px rgba(${c},0.45)`
                  : "inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.06)",
                transform: on ? "translateY(-2px)" : undefined,
              }}
            >
              {yes ? "Yes" : "No"}
            </button>
          );
        })}
      </div>

      <label className="mt-5 block">
        <span className="flex justify-between text-[12px] text-white/45">
          <span>Amount</span>
          {balance !== null && (
            <button type="button" className="hover:text-white" onClick={() => setAmount(fmtAmount(balance > parseEther("0.01") ? balance - parseEther("0.01") : 0n, 4).replace(/,/g, ""))}>
              Balance {fmtAmount(balance)} {sym()}
            </button>
          )}
        </span>
        <div className="relative mt-2">
          <input
            className="field mono pr-16"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            aria-label="Bet amount"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-white/40">{sym()}</span>
        </div>
      </label>
      <div className="mt-2 flex gap-2">
        {PRESETS.map((p) => (
          <button key={p} type="button" className="rounded-md px-2.5 py-1 text-[12px] text-white/55 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:text-white" onClick={() => setAmount(p)}>
            {p}
          </button>
        ))}
      </div>

      <p className="mt-5 text-[13px] leading-relaxed text-white/45">
        Payout is unknown until close — that’s the point. Your side is encrypted to this market’s ML-KEM-1024 key before it
        leaves your browser.
      </p>

      <div className="mt-5">
        {needsQuantumSetup ? (
          <div className="rounded-[14px] p-4 shadow-[inset_0_0_0_1px_rgba(185,171,255,0.22)]">
            <QuantumAccountSetup />
            {kind === null && (
              <button type="button" className="mt-3 w-full text-center text-[12px] text-white/40 hover:text-white" onClick={() => void connect()}>
                or connect a browser wallet
              </button>
            )}
          </div>
        ) : !address ? (
          <button type="button" className="pill w-full" onClick={() => void connect()}>
            Connect wallet
          </button>
        ) : wrongChain ? (
          <button type="button" className="pill w-full" onClick={() => void switchChain()}>
            Switch network
          </button>
        ) : (
          <button type="button" className="pill w-full" disabled={!canBet} onClick={() => void place()}>
            {tx.pending ? (
              <>
                <Spinner /> Sealing…
              </>
            ) : side === null ? (
              "Pick a side"
            ) : (
              `Seal & bet ${side === Side.Yes ? "Yes" : "No"}`
            )}
          </button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {tx.pending && <Notice>{tx.pending}</Notice>}
        {tx.error && <Notice tone="error">{tx.error}</Notice>}
        {tooSmall && <Notice tone="error">Minimum bet is 0.001 {sym()}.</Notice>}
        {tooBig && <Notice tone="error">That’s more than your balance.</Notice>}
      </div>
    </Glass>
  );
}
