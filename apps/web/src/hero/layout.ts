/** CSS-px rectangle, origin top-left of the viewport, y down. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HeroLayout {
  W: number;
  H: number;
  /** layout scale: S = blockWidth / 1730 (block height on portrait) */
  S: number;
  portrait: boolean;
  block: Rect;
  nav: Rect;
  panel: Rect;
  /** gap between shards, 14·S */
  cut: number;
  /** slab-space origin = block centre in world units */
  center: { x: number; y: number };
}

export const NAV_PANEL_GAP = 14;

/**
 * Page block centred with 5.5% side / 8.5% top-bottom margins (16 px on phones),
 * split into a nav slab (10.8% of the block) + 14 px gap + shard panel.
 */
export function computeLayout(W: number, H: number): HeroLayout {
  const phone = W < 640;
  const mx = phone ? 16 : W * 0.055;
  const my = phone ? 16 : H * 0.085;
  const block: Rect = { x: mx, y: my, w: W - 2 * mx, h: H - 2 * my };
  const portrait = H > W * 1.05;
  const S = (portrait ? Math.max(block.w, block.h * 0.9) : block.w) / 1730;

  const navH = Math.max(block.h * 0.108, phone ? 56 : 0);
  const nav: Rect = { x: block.x, y: block.y, w: block.w, h: navH };
  const panel: Rect = {
    x: block.x,
    y: block.y + navH + NAV_PANEL_GAP,
    w: block.w,
    h: block.h - navH - NAV_PANEL_GAP,
  };

  return {
    W,
    H,
    S,
    portrait,
    block,
    nav,
    panel,
    cut: 14 * S,
    center: { x: block.x + block.w / 2 - W / 2, y: H / 2 - (block.y + block.h / 2) },
  };
}

/** viewport px (y down) → slab space (world units, y up, origin at block centre) */
export function toSlab(L: HeroLayout, x: number, y: number): [number, number] {
  return [x - L.W / 2 - L.center.x, L.H / 2 - y - L.center.y];
}
