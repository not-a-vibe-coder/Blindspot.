"use client";

import Link from "next/link";
import { useState } from "react";
import { COPY, LINKS } from "./content";
import { TERMS } from "./Definitions";
import { BrandMark } from "@/components/BrandMark";

/**
 * Reduced-motion / no-WebGL landing: the same page as static DOM glass —
 * nav slab, shard panel, the same copy, and the five terms without any flight.
 */
export function StaticHero() {
  const [terms, setTerms] = useState(false);

  return (
    <main className="void flex min-h-dvh flex-col gap-[14px] px-4 py-4 sm:px-[5.5vw] sm:py-[8.5vh]">
      <nav className="glass glass-flat flex h-16 items-center justify-between px-6 sm:h-[10.8vh]">
        <Link href="/" className="flex items-center gap-3 text-[17px] font-[550] tracking-[-0.02em]">
          <BrandMark size={26} />
          {COPY.brand}
        </Link>
        <div className="hidden gap-9 text-sm sm:flex">
          {COPY.nav.map((l) => (
            <Link key={l} href={LINKS[l]} className="nav-link">
              {l}
            </Link>
          ))}
        </div>
        <Link href={LINKS.navRight} className="text-sm font-medium">
          {COPY.navRight}
        </Link>
      </nav>

      <section className="glass glass-flat relative flex flex-1 flex-col justify-between overflow-hidden p-8 sm:p-[4.5%]">
        {terms ? (
          <article className="max-w-2xl">
            <button type="button" className="link mb-8 text-sm" onClick={() => setTerms(false)}>
              ← Back
            </button>
            <h2 className="title text-2xl">Blindspot, in five terms.</h2>
            <div className="mt-5 space-y-4 text-[15px] leading-[1.72] text-white/60">
              {TERMS.map((t) => (
                <p key={t.term}>
                  <b className="font-semibold text-white">{t.term}</b> — {t.body}
                </p>
              ))}
            </div>
          </article>
        ) : (
          <div>
            <p className="eyebrow">{COPY.eyebrow}</p>
            <h1 className="headline mt-6 text-[clamp(56px,7.8vw,140px)]">
              {COPY.headline[0]}
              <br />
              {COPY.headline[1]}
            </h1>
            <p className="mt-8 max-w-xl text-[17px] leading-[1.5] text-white/55">{COPY.sub.join(" ")}</p>
            <div className="mt-8 flex items-center gap-6">
              <Link href={LINKS.pill} className="pill">
                {COPY.pill}
              </Link>
              <button type="button" className="link text-sm font-medium" onClick={() => setTerms(true)}>
                {COPY.link}
              </button>
            </div>
          </div>
        )}
        <footer className="mt-10 flex justify-between text-[11px] text-white/35">
          <span>{COPY.footLeft}</span>
          <span>{COPY.footRight}</span>
        </footer>
      </section>
    </main>
  );
}
