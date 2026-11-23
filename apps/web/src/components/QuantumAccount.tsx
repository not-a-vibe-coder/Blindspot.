"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import {
  FAUCET_URL,
  defaultSession,
  downloadBackup,
  fmtUqor,
  importSecret,
  openSession,
  readState,
  registerKey,
  type QuantumState,
} from "@/lib/quantum";
import { errMsg } from "@/lib/format";
import { Notice, Spinner } from "./bits";

/** Live chain state of the in-browser Blindspot account. */
export function useQuantumState() {
  const { quantum } = useWallet();
  const [state, setState] = useState<QuantumState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secret = quantum.secret;

  const refresh = useCallback(async () => {
    if (!secret) return setState(null);
    try {
      setState(await readState(secret));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [secret]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const ready = !!state?.registered && !!state.window?.live && (state.window.remainingTxs ?? 0n) > 0n;
  return { state, error, ready, refresh };
}

type Step = "create" | "fund" | "activate" | "session" | "ready";

function stepOf(s: QuantumState | null, hasSecret: boolean): Step {
  if (!hasSecret) return "create";
  if (!s) return "fund";
  if (!s.exists || s.balanceUqor === 0n) return "fund";
  if (!s.registered) return "activate";
  if (!s.window?.live || s.window.remainingTxs === 0n) return "session";
  return "ready";
}

const STEPS: { id: Step; label: string }[] = [
  { id: "create", label: "Create" },
  { id: "fund", label: "Fund" },
  { id: "activate", label: "Activate" },
  { id: "session", label: "Session" },
];

/**
 * Walks a bettor through QoreChain's post-quantum account requirements:
 * create → fund (faucet) → activate (register the ML-DSA-87 key) → open a betting session
 * (an EVM authorisation window, hybrid-signed). Shown wherever a write needs it.
 */
export function QuantumAccountSetup({ compact = false, onReady }: { compact?: boolean; onReady?: () => void }) {
  const { quantum, kind } = useWallet();
  const { state, error, ready, refresh } = useQuantumState();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const step = stepOf(state, !!quantum.secret);

  useEffect(() => {
    if (ready && kind === "quantum") onReady?.();
  }, [ready, kind, onReady]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const s = quantum.secret;
  const idx = STEPS.findIndex((x) => x.id === step);

  return (
    <div>
      {!compact && (
        <div className="mb-5 flex items-center gap-2">
          {STEPS.map((x, i) => (
            <div key={x.id} className="flex flex-1 flex-col gap-1.5">
              <div
                className="h-[3px] rounded-full transition-colors"
                style={{ background: i < idx || step === "ready" ? "#36d67e" : i === idx ? "#b9abff" : "rgba(255,255,255,0.08)" }}
              />
              <span className={`text-[10px] tracking-[0.08em] ${i <= idx ? "text-white/70" : "text-white/30"}`}>{x.label.toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}

      {step === "create" && (
        <>
          <h3 className="title text-[19px]">Create a post-quantum account</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/50">
            QoreChain only accepts transactions from accounts with a registered ML-DSA-87 key. Blindspot creates one in this
            browser — a classical key plus a post-quantum recovery code — and signs locally. No extension needed.
          </p>
          <button type="button" className="pill mt-5 w-full" disabled={!!busy} onClick={() => void run("create", quantum.create)}>
            {busy ? <Spinner /> : null} Create account
          </button>
          <label className="mt-3 block cursor-pointer text-center text-[12px] text-white/45 hover:text-white">
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await run("import", async () => (await importSecret(await f.text()), quantum.use()));
              }}
            />
            or restore from a backup file
          </label>
        </>
      )}

      {s && step === "fund" && (
        <>
          <h3 className="title text-[19px]">Fund it with test QOR</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/50">
            Claim from the QoreChain faucet (100 QOR / day) using this address — it’s the same account as your 0x address.
          </p>
          <button
            type="button"
            className="mono mt-4 w-full break-all rounded-[10px] bg-black/30 px-3 py-3 text-left text-[12px] text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] hover:text-white"
            onClick={() => {
              void navigator.clipboard.writeText(s.qor);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {s.qor}
            <span className="mt-1 block text-[10px] tracking-[0.1em] text-[#b9abff]">{copied ? "COPIED" : "CLICK TO COPY"}</span>
          </button>
          <div className="mt-4 flex gap-2">
            <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="pill flex-1">
              Open faucet ↗
            </a>
            <button type="button" className="pill pill-ghost" onClick={() => void refresh()}>
              Check
            </button>
          </div>
          <p className="mt-3 flex items-center gap-2 text-[11px] text-white/35">
            <Spinner size={10} /> Waiting for funds — this updates by itself.
          </p>
        </>
      )}

      {s && step === "activate" && state && (
        <>
          <h3 className="title text-[19px]">Activate your post-quantum key</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/50">
            Registers this account’s ML-DSA-87 public key on QoreChain, with a proof that you hold it. One time, ~0.09 QOR.
          </p>
          <p className="mt-3 text-[12px] text-white/40">Balance: {fmtUqor(state.balanceUqor)} QOR</p>
          <button type="button" className="pill mt-4 w-full" disabled={!!busy} onClick={() => void run("register", () => registerKey(s))}>
            {busy ? (
              <>
                <Spinner /> Registering…
              </>
            ) : (
              "Activate key"
            )}
          </button>
        </>
      )}

      {s && step === "session" && state && (
        <SessionStep balance={state.balanceUqor} busy={!!busy} expired={!!state.window} onOpen={(p) => void run("session", () => openSession(s, p))} />
      )}

      {s && step === "ready" && state?.window && (
        <div>
          <p className="flex items-center gap-2 text-[13px] text-[#36d67e]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#36d67e] shadow-[0_0_8px_#36d67e]" />
            Session open
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-white/50">
            {state.window.remainingTxs.toString()} transactions · {fmtUqor(state.window.remainingValue)} QOR spend cap · {blocksLeft(state.window.remainingBlocks)} left · balance{" "}
            {fmtUqor(state.balanceUqor)} QOR
          </p>
        </div>
      )}

      {s && !compact && (
        <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4 text-[11px] text-white/40">
          <span className="mono">
            {s.evm.slice(0, 8)}…{s.evm.slice(-4)}
          </span>
          <button type="button" className="hover:text-white" onClick={() => downloadBackup(s)}>
            Download backup
          </button>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {actionError && <Notice tone="error">{actionError}</Notice>}
        {error && !actionError && <Notice tone="error">{error}</Notice>}
      </div>
    </div>
  );
}

/** testnet blocks are ~1.0–1.3 s */
function blocksLeft(blocks: bigint): string {
  const min = Math.round((Number(blocks) * 1.15) / 60);
  return min >= 90 ? `~${Math.round(min / 60)}h` : `~${min}m`;
}

function SessionStep({ balance, busy, expired, onOpen }: { balance: bigint; busy: boolean; expired: boolean; onOpen: (p: ReturnType<typeof defaultSession>) => void }) {
  const p = defaultSession(balance);
  return (
    <>
      <h3 className="title text-[19px]">{expired ? "Your session ended" : "Open a betting session"}</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-white/50">
        Your post-quantum key authorises a bounded window for EVM bets — a stolen classical key alone could never open one.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ["~5h", "duration"],
          [String(p.maxTxs), "transactions"],
          [fmtUqor(p.maxValueUqor), "QOR cap"],
        ].map(([v, l]) => (
          <div key={l} className="rounded-[10px] bg-black/25 px-2 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
            <p className="text-[15px] font-medium">{v}</p>
            <p className="text-[10px] text-white/40">{l}</p>
          </div>
        ))}
      </div>
      <button type="button" className="pill mt-4 w-full" disabled={busy} onClick={() => onOpen(p)}>
        {busy ? (
          <>
            <Spinner /> Signing with ML-DSA-87…
          </>
        ) : (
          "Open session"
        )}
      </button>
    </>
  );
}
