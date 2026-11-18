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
  const start = m.info.closeTime - (m.info.revealDeadline - m.info.closeTime) * 4n;
  const span = Number(m.info.resolveDeadline - start) || 1;
  const progress = Math.min(1, Math.max(0, Number(now - start) / span));

  return (
    <div className="mt-8">
      <div className="relative h-px bg-white/10">
        <div className="absolute left-0 top-0 h-px bg-gradient-to-r from-[#36d67e] via-[#b9abff] to-white/60" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
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
