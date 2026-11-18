"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { FONT, itemWidth, type Item } from "./content";

interface Props {
  items: Item[];
  hidden?: boolean;
  width: number;
  height: number;
  onHover: (key: string, on: boolean) => void;
  onAction?: (action: NonNullable<Item["action"]>) => void;
}

/**
 * Transparent DOM copy of everything printed on one glass surface.
 * The parent maps this box onto the tilted glass with a matrix3d homography, so the
 * text is selectable (blue selection box over the print) and controls are real hit areas.
 */
export const TextLayer = forwardRef<HTMLDivElement, Props>(function TextLayer(
  { items, hidden, width, height, onHover, onAction },
  ref,
) {
  return (
    <div
      ref={ref}
      className="hero-text-layer"
      data-hidden={hidden ? "true" : "false"}
      aria-hidden={hidden}
      style={{ width, height, position: "absolute", left: 0, top: 0, transformOrigin: "0 0", pointerEvents: "none" }}
    >
      {items.map((it) => {
        const w = itemWidth(it);
        const style: React.CSSProperties = {
          position: "absolute",
          top: it.y,
          left: it.align === "right" ? it.x - w : it.x,
          width: it.kind === "pill" || it.kind === "mark" ? it.w : undefined,
          height: it.kind === "pill" || it.kind === "mark" ? it.h : undefined,
          font: `${it.weight} ${it.size}px/${it.leading} ${FONT}`,
          letterSpacing: `${it.tracking}em`,
          whiteSpace: "pre",
          color: "transparent",
          pointerEvents: "auto",
        };
        const hover = {
          onMouseEnter: () => onHover(it.key, true),
          onMouseLeave: () => onHover(it.key, false),
          onFocus: () => onHover(it.key, true),
          onBlur: () => onHover(it.key, false),
        };
        const text = it.lines.map((l, i) => (
          <span key={i} style={{ display: "block" }}>
            {l}
          </span>
        ));

        if (it.kind === "pill") {
          return (
            <Link key={it.key} href={it.href!} style={{ ...style, display: "grid", placeItems: "center", borderRadius: 6, lineHeight: 1 }} {...hover}>
              {it.lines[0]}
            </Link>
          );
        }
        if (it.action) {
          return (
            <button key={it.key} type="button" style={{ ...style, cursor: "pointer", background: "none", padding: 0 }} onClick={() => onAction?.(it.action!)} {...hover}>
              {text}
            </button>
          );
        }
        if (it.href) {
          const external = it.href.startsWith("http");
          return (
            <Link key={it.key} href={it.href} style={style} {...hover} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} aria-label={it.kind === "mark" ? "Blindspot home" : undefined}>
              {it.kind === "mark" ? null : text}
            </Link>
          );
        }
        return (
          <div key={it.key} style={style} role={it.kind === "headline" ? "heading" : undefined} aria-level={it.kind === "headline" ? 1 : undefined}>
            {text}
          </div>
        );
      })}
    </div>
  );
});
