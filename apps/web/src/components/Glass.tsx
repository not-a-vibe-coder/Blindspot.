"use client";

import { forwardRef, useCallback, useRef, type ElementType, type HTMLAttributes } from "react";

type GlassProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  /** tilt + lift + sheen + cursor glow on hover (the hero's shard behaviour) */
  interactive?: boolean;
  /** max tilt in degrees */
  tilt?: number;
  /** lift toward the viewer on hover, px */
  lift?: number;
  href?: string;
};

/**
 * A DOM shard of the hero's smoked glass. Interactive shards tip as if pressed at the
 * pointer, lift toward the viewer, brighten their iridescent rim and glow lavender under
 * the cursor — the same rules as the WebGL landing, in CSS.
 */
export const Glass = forwardRef<HTMLElement, GlassProps>(function Glass(
  { as: Tag = "div", interactive = false, tilt = 2.2, lift = 10, className = "", style, onPointerMove, onPointerLeave, ...rest },
  fwd,
) {
  const local = useRef<HTMLElement | null>(null);
  const setRef = useCallback(
    (el: HTMLElement | null) => {
      local.current = el;
      if (typeof fwd === "function") fwd(el);
      else if (fwd) fwd.current = el;
    },
    [fwd],
  );

  const move = (e: React.PointerEvent<HTMLElement>) => {
    onPointerMove?.(e);
    const el = local.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
    el.style.setProperty("--hover", "1");
    if (interactive) {
      el.style.setProperty("--ry", `${(x - 0.5) * 2 * tilt}deg`);
      el.style.setProperty("--rx", `${(0.5 - y) * 2 * tilt}deg`);
      el.style.setProperty("--lift", `${lift}px`);
    }
  };

  const leave = (e: React.PointerEvent<HTMLElement>) => {
    onPointerLeave?.(e);
    const el = local.current;
    if (!el) return;
    el.style.setProperty("--hover", "0");
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--lift", "0px");
  };

  return (
    <Tag
      ref={setRef}
      className={`glass ${interactive ? "" : "glass-flat"} ${className}`}
      style={style}
      onPointerMove={move}
      onPointerLeave={leave}
      {...rest}
    />
  );
});
