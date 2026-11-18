"use client";

import { configured } from "@/lib/config";
import { Glass } from "./Glass";

export function NotConfigured() {
  if (configured) return null;
  return (
    <Glass className="p-6">
      <p className="eyebrow">Setup</p>
      <p className="mt-2 text-[15px] text-white/70">
        No contract configured. Set <code className="mono text-white">NEXT_PUBLIC_BLINDSPOT_ADDRESS</code> (and{" "}
        <code className="mono text-white">NEXT_PUBLIC_CHAIN_ID</code>) — or run <code className="mono text-white">pnpm devnet</code>, which
        writes <code className="mono text-white">apps/web/.env.local</code> for you.
      </p>
    </Glass>
  );
}
