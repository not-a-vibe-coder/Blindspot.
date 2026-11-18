"use client";

import { useEffect, useRef, useState } from "react";
import { GlassHero, type HeroMode } from "./hero";
import { TextLayer } from "./TextLayer";
import { Definitions } from "./Definitions";
import { matrix3dFor } from "./homography";
import type { Item } from "./content";
import type { HeroLayout } from "./layout";

export default function GlassHeroView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<GlassHero | null>(null);
  const [layout, setLayout] = useState<{ panel: Item[]; nav: Item[]; L: HeroLayout } | null>(null);
  const [mode, setMode] = useState<HeroMode>("gone");
  const [terms, setTerms] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const hero = new GlassHero(canvas, {
      onLayout: (panel, nav, L) => setLayout({ panel, nav, L }),
      onMode: setMode,
      onFrame: (h) => {
        const { L } = h;
        if (panelRef.current) panelRef.current.style.transform = matrix3dFor(L.panel.w, L.panel.h, h.surfaceQuad("panel"));
        if (navRef.current) navRef.current.style.transform = matrix3dFor(L.nav.w, L.nav.h, h.surfaceQuad("nav"));
      },
    });
    heroRef.current = hero;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __hero?: GlassHero }).__hero = hero;
    const onResize = () => hero.resize();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && hero.mode === "gone") {
        setTerms(false);
        hero.assemble();
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      hero.dispose();
      heroRef.current = null;
    };
  }, []);

  const onHover = (key: string, on: boolean) => heroRef.current?.setHover(key, on);
  const shatter = () => {
    const h = heroRef.current;
    if (!h || h.mode !== "assembled") return;
    h.setHover("link", false);
    setTerms(true);
    h.shatter();
  };
  const back = () => {
    setTerms(false);
    heroRef.current?.assemble();
  };
  const textHidden = mode !== "assembled";

  return (
    <div className="hero-root fixed inset-0 overflow-hidden bg-[#050507]">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
      {layout && (
        <>
          <TextLayer
            ref={panelRef}
            items={layout.panel}
            hidden={textHidden}
            width={layout.L.panel.w}
            height={layout.L.panel.h}
            onHover={onHover}
            onAction={shatter}
          />
          <TextLayer ref={navRef} items={layout.nav} hidden={textHidden} width={layout.L.nav.w} height={layout.L.nav.h} onHover={onHover} />
        </>
      )}
      <Definitions visible={terms} onBack={back} />
    </div>
  );
}
