/**
 * The cut pattern: five cells measured from the reference, in panel-normalised
 * coordinates (x right, y down).
 */
export type Pt = [number, number];
export type CellId = "A" | "B" | "C" | "D" | "E";

type PointId = "TL" | "TR" | "BR" | "BL" | "tAB" | "tBC" | "tCE" | "bAD" | "bDE" | "J0" | "J1" | "J2";
type Kind = "corner" | "top" | "bottom" | "junction";

const BASE: Record<PointId, { p: Pt; kind: Kind }> = {
  TL: { p: [0, 0], kind: "corner" },
  TR: { p: [1, 0], kind: "corner" },
  BR: { p: [1, 1], kind: "corner" },
  BL: { p: [0, 1], kind: "corner" },
  tAB: { p: [0.22, 0], kind: "top" },
  tBC: { p: [0.515, 0], kind: "top" },
  tCE: { p: [0.84, 0], kind: "top" },
  bAD: { p: [0.34, 1], kind: "bottom" },
  bDE: { p: [0.865, 1], kind: "bottom" },
  J0: { p: [0.385, 0.72], kind: "junction" },
  J1: { p: [0.48, 0.62], kind: "junction" },
  J2: { p: [0.716, 0.49], kind: "junction" },
};

export const CELLS: Record<CellId, PointId[]> = {
  A: ["TL", "tAB", "J0", "bAD", "BL"], // hero
  B: ["tAB", "tBC", "J1", "J0"],
  C: ["tBC", "tCE", "J2", "J1"],
  D: ["J0", "J1", "J2", "bDE", "bAD"],
  E: ["tCE", "TR", "BR", "bDE", "J2"],
};

export const CELL_IDS = Object.keys(CELLS) as CellId[];

/** Static pattern (no drift, no cursor). `portrait` transposes so the hero cell sits on top. */
export function cutPattern(portrait = false): Record<CellId, Pt[]> {
  const pts = Object.fromEntries(Object.entries(BASE).map(([id, v]) => [id, v.p])) as Record<PointId, Pt>;
  return cells(pts, portrait);
}

export function cells(pts: Record<PointId, Pt>, portrait: boolean): Record<CellId, Pt[]> {
  const out = {} as Record<CellId, Pt[]>;
  for (const id of CELL_IDS) {
    out[id] = CELLS[id].map((pid) => {
      const [x, y] = pts[pid];
      return portrait ? [y, x] : [x, y];
    });
  }
  return out;
}

/** Deterministic per-point randomness so the pattern breathes the same way every load. */
function rand(seed: string, k: number): number {
  let h = 2166136261 ^ k;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const DRIFT = Object.fromEntries(
  (Object.keys(BASE) as PointId[]).map((id) => [
    id,
    {
      px: 10 + rand(id, 1) * 10, // period x, s
      py: 10 + rand(id, 2) * 10, // period y, s
      fx: rand(id, 3) * Math.PI * 2,
      fy: rand(id, 4) * Math.PI * 2,
    },
  ]),
) as Record<PointId, { px: number; py: number; fx: number; fy: number }>;

const PUSH_RADIUS = 0.6;
const PUSH_MAX = 0.05;

/**
 * The live pattern at time t (seconds).
 *  - every point drifts on its own slow sine: x ±.03; junctions also y ±.05; periods 10–20 s
 *  - points within .6 of the pointer are pushed away by up to .05, so the cell under it grows
 *  - `pointer` is in screen-panel coordinates (x right, y down); `push` ∈ [0,1] fades it in/out
 */
export function livePattern(t: number, pointer: Pt | null, push: number, portrait: boolean): Record<CellId, Pt[]> {
  // pattern space is transposed on portrait, so bring the pointer into it
  const ptr: Pt | null = pointer ? (portrait ? [pointer[1], pointer[0]] : pointer) : null;
  const pts = {} as Record<PointId, Pt>;

  for (const id of Object.keys(BASE) as PointId[]) {
    const { p, kind } = BASE[id];
    let [x, y] = p;
    if (kind !== "corner") {
      const d = DRIFT[id];
      x += 0.03 * Math.sin((2 * Math.PI * t) / d.px + d.fx);
      if (kind === "junction") y += 0.05 * Math.sin((2 * Math.PI * t) / d.py + d.fy);

      if (ptr && push > 0) {
        const dx = x - ptr[0];
        const dy = y - ptr[1];
        const dist = Math.hypot(dx, dy);
        if (dist < PUSH_RADIUS && dist > 1e-4) {
          const f = PUSH_MAX * push * (1 - dist / PUSH_RADIUS);
          x += (dx / dist) * f;
          if (kind === "junction") y += (dy / dist) * f;
        }
      }
      x = Math.min(0.95, Math.max(0.05, x));
      y = kind === "junction" ? Math.min(0.92, Math.max(0.08, y)) : y;
    }
    pts[id] = [x, y];
  }
  return cells(pts, portrait);
}

export { BASE as CUT_POINTS };
export type { PointId, Kind };
