"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "./BrandMark";
import { Glass } from "./Glass";
import { useWallet } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";
import { chain } from "@/lib/config";

const LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "https://github.com/not-a-vibe-coder/Blindspot.#readme", label: "Docs" },
];

/** The hero's nav slab, as a DOM glass bar. */
export function AppNav() {
  const path = usePathname();
  return (
    <Glass as="nav" className="flex h-[72px] items-center justify-between px-5 sm:px-7">
      <Link href="/" className="flex items-center gap-3 text-[17px] font-[550] tracking-[-0.02em]">
        <BrandMark size={26} />
        Blindspot
      </Link>
      <div className="hidden items-center gap-9 text-[14px] md:flex">
        {LINKS.map((l) => {
          const external = l.href.startsWith("http");
          const active = !external && path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className="nav-link"
              aria-current={active ? "page" : undefined}
              {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
      <ConnectButton />
    </Glass>
  );
}

export function ConnectButton() {
  const { address, wallets, connect, disconnect, connecting, wrongChain, switchChain, error } = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  if (address && wrongChain) {
    return (
      <button type="button" className="text-[14px] font-medium text-[#b9abff] hover:underline" onClick={() => void switchChain()}>
        Switch to {chain.name}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex items-center gap-2 text-[14px] font-medium text-white transition-colors hover:text-[#b9abff]"
        onClick={() => (address ? setOpen((o) => !o) : wallets.length > 1 ? setOpen((o) => !o) : void connect())}
        disabled={connecting}
      >
        {address ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-[#36d67e] shadow-[0_0_8px_#36d67e]" />
            <span className="mono text-[13px]">{shortAddr(address)}</span>
          </>
        ) : connecting ? (
          "Connecting…"
        ) : (
          "Connect"
        )}
      </button>

      {open && (
        <Glass className="fly-in absolute right-0 top-[calc(100%+18px)] z-50 w-64 p-2" style={{ borderRadius: 14 }}>
          {address ? (
            <div className="p-2">
              <p className="eyebrow">Connected</p>
              <p className="mono mt-2 break-all text-[12px] text-white/80">{address}</p>
              <p className="mt-1 text-[12px] text-white/40">{chain.name}</p>
              <button type="button" className="pill pill-ghost mt-4 h-9 w-full text-[13px]" onClick={() => (disconnect(), setOpen(false))}>
                Disconnect
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              <p className="eyebrow px-2 pb-2 pt-1">Choose a wallet</p>
              {wallets.map((w) => (
                <button
                  key={w.uuid}
                  type="button"
                  className="flex items-center gap-3 rounded-[10px] px-2 py-2 text-left text-[14px] hover:bg-white/5"
                  onClick={() => (void connect(w), setOpen(false))}
                >
                  {w.icon ? <img src={w.icon} alt="" className="h-6 w-6 rounded-md" /> : <span className="h-6 w-6 rounded-md bg-white/10" />}
                  {w.name}
                </button>
              ))}
            </div>
          )}
        </Glass>
      )}
      {error && !address && <p className="absolute right-0 top-[calc(100%+12px)] w-64 text-right text-[12px] text-[#ff8a9a]">{error}</p>}
    </div>
  );
}
