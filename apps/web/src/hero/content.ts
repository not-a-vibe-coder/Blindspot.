import type { HeroLayout } from "./layout";

/**
 * Everything printed on the glass, laid out once in panel/nav pixel space.
 * The same items drive the canvas print AND the transparent DOM text layer,
 * so selection boxes and hit areas line up with the glass exactly.
 */
export const FONT = '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif';

export interface Item {
  key: string;
  kind: "text" | "headline" | "pill" | "link" | "mark";
  /** one entry per line */
  lines: string[];
  /** left of the box, px from the surface's top-left */
  x: number;
  /** top of the first line box */
  y: number;
  size: number;
  weight: number;
  /** em */
  tracking: number;
  /** line box height as a multiple of size */
  leading: number;
  color: string;
  align?: "left" | "right";
  /** pill / mark box */
  w?: number;
  h?: number;
  href?: string;
  action?: "shatter";
}

export const COPY = {
  eyebrow: "POST-QUANTUM PREDICTION MARKET",
  headline: ["Bet blind.", "Win clear."],
  sub: [
    "Every side is sealed with ML-KEM-1024 until the market closes. No whales",
    "to copy, no herd to follow — only what you actually believe.",
  ],
  pill: "Enter markets",
  link: "How it works →",
  footLeft: "© Blindspot",
  footRight: "ML-KEM-1024 · ML-DSA-87 · QoreChain",
  brand: "Blindspot",
  nav: ["Markets", "Portfolio", "Docs"],
  navRight: "Launch app",
} as const;

export const LINKS = {
  pill: "/markets",
  Markets: "/markets",
  Portfolio: "/portfolio",
  Docs: "https://github.com/not-a-vibe-coder/Blindspot.#readme",
  navRight: "/markets",
} as const;

let measureCtx: CanvasRenderingContext2D | null = null;
export function measure(text: string, size: number, weight: number, tracking: number): number {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  const w = measureCtx.measureText(text).width;
  return w + text.length * tracking * size;
}

export function panelItems(L: HeroLayout): Item[] {
  const { panel: P, S, portrait } = L;
  const pw = P.w;
  const ph = P.h;
  const padX = portrait ? pw * 0.08 : pw * 0.045;

  const eyebrowSize = Math.max(11 * S, 10);
  const hs = portrait ? Math.min(0.15 * pw, 0.085 * ph) : Math.min(0.078 * pw, 0.2 * ph);
  const subSize = Math.max(portrait ? 15 : 19 * S, 13.5);
  const pillH = Math.max(40 * S, 36);
  const pillText = Math.max(14 * S, 13);
  const pillW = Math.max(measure(COPY.pill, pillText, 500, -0.01) + 40 * Math.max(S, 0.8), 136 * S);

  const eyebrowTop = ph * (portrait ? 0.07 : 0.135) - eyebrowSize;
  const headTop = eyebrowTop + eyebrowSize * 1.2 + hs * 0.38;
  const subTop = headTop + hs * 0.97 * 2 + hs * 0.32;
  const subLeading = 1.5;
  const sub: string[] = portrait ? [COPY.sub.join(" ")] : [...COPY.sub];
  const subLines = portrait ? wrap(sub[0]!, subSize, 400, pw - padX * 2) : sub;
  const ctaTop = subTop + subSize * subLeading * subLines.length + hs * 0.3;
  const footSize = Math.max(11 * S, 10);
  const footTop = ph - Math.max(30 * S, 20) - footSize;

  return [
    { key: "eyebrow", kind: "text", lines: [COPY.eyebrow], x: padX, y: eyebrowTop, size: eyebrowSize, weight: 500, tracking: 0.2, leading: 1.2, color: "rgba(255,255,255,0.38)" },
    { key: "headline", kind: "headline", lines: [...COPY.headline], x: padX - hs * 0.04, y: headTop, size: hs, weight: 500, tracking: -0.045, leading: 0.97, color: "#dcdce0" },
    { key: "sub", kind: "text", lines: subLines, x: padX, y: subTop, size: subSize, weight: 400, tracking: -0.005, leading: subLeading, color: "rgba(255,255,255,0.55)" },
    { key: "pill", kind: "pill", lines: [COPY.pill], x: padX, y: ctaTop, w: pillW, h: pillH, size: pillText, weight: 500, tracking: -0.01, leading: 1, color: "#0a0a0c", href: LINKS.pill },
    { key: "link", kind: "link", lines: [COPY.link], x: padX + pillW + 26 * Math.max(S, 0.8), y: ctaTop + (pillH - pillText * 1.2) / 2, size: pillText, weight: 500, tracking: -0.01, leading: 1.2, color: "rgba(255,255,255,0.82)", action: "shatter" },
    { key: "footLeft", kind: "text", lines: [COPY.footLeft], x: padX, y: footTop, size: footSize, weight: 400, tracking: 0.02, leading: 1.2, color: "rgba(255,255,255,0.34)" },
    { key: "footRight", kind: "text", lines: [COPY.footRight], x: pw - padX, y: footTop, size: footSize, weight: 400, tracking: 0.02, leading: 1.2, color: "rgba(255,255,255,0.34)", align: "right" },
  ];
}

export function navItems(L: HeroLayout): Item[] {
  const { nav: N, portrait } = L;
  const h = N.h;
  const pad = portrait ? N.w * 0.06 : N.w * 0.028;
  const mark = h * 0.3;
  const brandSize = Math.max(h * 0.2, 15);
  const linkSize = Math.max(h * 0.165, 13);
  const mid = h / 2;
  const items: Item[] = [
    { key: "mark", kind: "mark", lines: [""], x: pad, y: mid - mark / 2, w: mark, h: mark, size: mark, weight: 500, tracking: 0, leading: 1, color: "#fff", href: "/" },
    { key: "brand", kind: "text", lines: [COPY.brand], x: pad + mark + h * 0.16, y: mid - brandSize * 0.6, size: brandSize, weight: 550, tracking: -0.02, leading: 1.2, color: "#ffffff", href: "/" },
  ];
  if (!portrait) {
    let x = N.w * 0.36;
    for (const label of COPY.nav) {
      items.push({ key: `nav:${label}`, kind: "link", lines: [label], x, y: mid - linkSize * 0.6, size: linkSize, weight: 450, tracking: -0.005, leading: 1.2, color: "rgba(255,255,255,0.6)", href: LINKS[label] });
      x += measure(label, linkSize, 450, -0.005) + h * 0.42;
    }
  }
  items.push({ key: "navRight", kind: "link", lines: [COPY.navRight], x: N.w - pad, y: mid - linkSize * 0.6, size: linkSize, weight: 500, tracking: -0.005, leading: 1.2, color: "#ffffff", align: "right", href: LINKS.navRight });
  return items;
}

function wrap(text: string, size: number, weight: number, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (measure(next, size, weight, 0) > maxW && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Width of an item's widest line (for right alignment, hit areas). */
export function itemWidth(it: Item): number {
  if (it.w) return it.w;
  return Math.max(...it.lines.map((l) => measure(l, it.size, it.weight, it.tracking)));
}

// ───────────────────────────── canvas print ─────────────────────────────

function setFont(ctx: CanvasRenderingContext2D, it: Item) {
  ctx.font = `${it.weight} ${it.size}px ${FONT}`;
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${it.tracking * it.size}px`;
}

/**
 * Baseline of line i inside its CSS line box, using Inter's hhea metrics
 * (ascender 1984/2048, descender 496/2048), so canvas print and DOM text agree.
 */
const INTER_ASC = 1984 / 2048;
const INTER_DESC = 496 / 2048;
function baseline(it: Item, i: number): number {
  const box = it.size * it.leading;
  return it.y + i * box + box / 2 + ((INTER_ASC - INTER_DESC) / 2) * it.size;
}

export function drawItems(
  ctx: CanvasRenderingContext2D,
  items: Item[],
  w: number,
  h: number,
  hover: ReadonlySet<string>,
) {
  ctx.clearRect(0, 0, w, h);
  for (const it of items) {
    const hot = hover.has(it.key);
    ctx.save();
    setFont(ctx, it);
    ctx.textBaseline = "alphabetic";

    if (it.kind === "mark") {
      drawMark(ctx, it.x, it.y, it.w!);
    } else if (it.kind === "pill") {
      ctx.fillStyle = hot ? "#36d67e" : "#ececf0";
      roundRect(ctx, it.x, it.y, it.w!, it.h!, 6);
      ctx.fill();
      ctx.fillStyle = "#0a0a0c";
      const tw = measure(it.lines[0]!, it.size, it.weight, it.tracking);
      ctx.fillText(it.lines[0]!, it.x + (it.w! - tw) / 2, it.y + it.h! / 2 + ((INTER_ASC - INTER_DESC) / 2) * it.size);
    } else {
      if (it.kind === "headline") {
        const top = it.y;
        const bottom = it.y + it.size * it.leading * it.lines.length;
        const g = ctx.createLinearGradient(0, top, 0, bottom);
        g.addColorStop(0, "#dcdce0");
        g.addColorStop(1, "#bdbdc3");
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = hot && it.key.startsWith("nav:") ? "#ffffff" : it.color;
      }
      it.lines.forEach((line, i) => {
        const lw = measure(line, it.size, it.weight, it.tracking);
        const x = it.align === "right" ? it.x - lw : it.x;
        const y = baseline(it, i);
        ctx.fillText(line, x, y);
        if (it.kind === "link" && hot && !it.key.startsWith("nav:")) {
          ctx.fillRect(x, y + it.size * 0.18, lw - it.tracking * it.size, Math.max(1, it.size * 0.07));
        }
      });
    }
    ctx.restore();
  }
}

/** The Blindspot mark: a smoked-glass square with an off-centre "blind spot". */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const g = ctx.createLinearGradient(x, y, x + s, y + s);
  g.addColorStop(0, "#d9d6ff");
  g.addColorStop(0.55, "#9fe9c3");
  g.addColorStop(1, "#5d5a7a");
  ctx.fillStyle = g;
  roundRect(ctx, x, y, s, s, s * 0.24);
  ctx.fill();
  ctx.fillStyle = "#050507";
  ctx.beginPath();
  ctx.arc(x + s * 0.62, y + s * 0.4, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { baseline };
