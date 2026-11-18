"use client";

import type { MarketView } from "@/lib/market";
import { countdown, dateTime } from "@/lib/format";

/** Close → reveal deadline → resolve deadline, with a hairline progress rail. */
export function Timeline({ m, now }: { m: MarketView; now: bigint }) {
  const steps = [
    { at: m.info.closeTime, label: "Betting closes", hint: "sides stay sealed until here" },
    { at: m.info.revealDeadline, label: "Reveals end", hint: "keyper key + reveals before this" },
    { at: m.info.resolveDeadline, label: "Resolve deadline", hint: "no outcome by now → refunds" },
  ];
  // piecewise rail: each third of the rail is one phase, ending under its label
  const frac = (from: bigint, to: bigint) => Math.min(1, Math.max(0, Number(now - from) / (Number(to - from) || 1)));
  const DAY3 = 3n * 86_400n;
  const progress =
    now < m.info.closeTime
      ? frac(m.info.closeTime - DAY3, m.info.closeTime) / 3
      : now < m.info.revealDeadline
        ? 1 / 3 + frac(m.info.closeTime, m.info.revealDeadline) / 3
        : 2 / 3 + frac(m.info.revealDeadline, m.info.resolveDeadline) / 3;

  return (
    <div className="mt-8">
      <div className="relative h-px bg-white/10">
        <div className="absolute left-0 top-0 h-px bg-gradient-to-r from-[#36d67e] via-[#b9abff] to-white/60" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4 [&>div]:text-right">
        {steps.map((s) => {
          const passed = now >= s.at;
          return (
            <div key={s.label}>
              <p className={`text-[12px] font-medium ${passed ? "text-white/40" : "text-white"}`}>{s.label}</p>
              <p className="mono mt-1 text-[12px] text-white/50">{dateTime(s.at)}</p>
              <p className="mt-0.5 text-[11px] text-white/35">{passed ? "passed" : `in ${countdown(s.at - now)}`}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
