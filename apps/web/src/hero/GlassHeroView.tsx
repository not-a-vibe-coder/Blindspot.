"use client";

import { useEffect, useRef, useState } from "react";
import { GlassHero } from "./hero";
import { TextLayer } from "./TextLayer";
import { matrix3dFor } from "./homography";
import type { Item } from "./content";
import type { HeroLayout } from "./layout";

export default function GlassHeroView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<GlassHero | null>(null);
  const [layout, setLayout] = useState<{ panel: Item[]; nav: Item[]; L: HeroLayout } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const hero = new GlassHero(canvas, {
      onLayout: (panel, nav, L) => setLayout({ panel, nav, L }),
      onFrame: (h) => {
        const { L } = h;
        if (panelRef.current) panelRef.current.style.transform = matrix3dFor(L.panel.w, L.panel.h, h.surfaceQuad("panel"));
        if (navRef.current) navRef.current.style.transform = matrix3dFor(L.nav.w, L.nav.h, h.surfaceQuad("nav"));
      },
    });
    heroRef.current = hero;
    const onResize = () => hero.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      hero.dispose();
      heroRef.current = null;
    };
  }, []);

  const onHover = (key: string, on: boolean) => heroRef.current?.setHover(key, on);

  return (
    <div className="hero-root fixed inset-0 overflow-hidden bg-[#050507]">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
      {layout && (
        <>
          <TextLayer ref={panelRef} items={layout.panel} width={layout.L.panel.w} height={layout.L.panel.h} onHover={onHover} />
          <TextLayer ref={navRef} items={layout.nav} width={layout.L.nav.w} height={layout.L.nav.h} onHover={onHover} />
        </>
      )}
    </div>
  );
}
