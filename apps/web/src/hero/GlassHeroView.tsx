"use client";

import { useEffect, useRef } from "react";
import { GlassHero } from "./hero";

export default function GlassHeroView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const hero = new GlassHero(canvas);
    const onResize = () => hero.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      hero.dispose();
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#050507]">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
