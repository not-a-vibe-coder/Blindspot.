"use client";

import { Side } from "@blindspot/sdk";
import type { Phase } from "@/lib/market";
import { PHASE_LABEL } from "@/lib/market";

/** A side that is still sealed: frosted glass with a moving sheen. */
export function SealedChip({ className = "" }: { className?: string }) {
  return (
    <span className={`sealed-chip inline-flex h-6 w-[58px] items-center justify-center ${className}`} title="Sealed with ML-KEM-1024">
      <LockGlyph />
    </span>
  );
}

function LockGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden className="relative z-10 opacity-60">
      <rect x="2" y="5.2" width="8" height="5.8" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5.2V3.8a2 2 0 1 1 4 0v1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** Yes = #36d67e, No = #b9abff — the hero's two accents. */
export function SideBadge({ side, animate = false, you = false }: { side: Side; animate?: boolean; you?: boolean }) {
  if (side === Side.Hidden) return <SealedChip />;
  const yes = side === Side.Yes;
  return (
    <span
      className={`inline-flex h-6 min-w-[58px] items-center justify-center gap-1 rounded-[6px] px-2 text-[11px] font-semibold tracking-[0.12em] ${animate ? "reveal-in" : ""}`}
      style={{
        color: yes ? "#36d67e" : "#b9abff",
        background: yes ? "rgba(54,214,126,0.1)" : "rgba(185,171,255,0.1)",
        boxShadow: `inset 0 0 0 1px ${yes ? "rgba(54,214,126,0.3)" : "rgba(185,171,255,0.3)"}`,
      }}
    >
      {yes ? "YES" : "NO"}
      {you && <span className="font-medium tracking-normal opacity-70">· you</span>}
    </span>
  );
}

const PHASE_DOT: Record<Phase, string> = {
  open: "#36d67e",
  unsealing: "#b9abff",
  awaiting: "#f2c46d",
  settled: "rgba(255,255,255,0.5)",
};

export function PhaseChip({ phase }: { phase: Phase }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-[0.04em] text-white/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: PHASE_DOT[phase], boxShadow: phase === "open" ? `0 0 10px ${PHASE_DOT[phase]}` : undefined }}
      />
      {PHASE_LABEL[phase]}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="mt-2 text-2xl font-medium tracking-[-0.03em] text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-white/40">{sub}</p>}
    </div>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "ok"; children: React.ReactNode }) {
  const color = tone === "error" ? "#ff8a9a" : tone === "ok" ? "#36d67e" : "rgba(255,255,255,0.6)";
  return (
    <p className="rounded-[10px] px-3 py-2.5 text-[13px] leading-snug" style={{ color, background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}>
      {children}
    </p>
  );
}
