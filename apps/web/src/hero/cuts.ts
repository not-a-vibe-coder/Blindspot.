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

export { BASE as CUT_POINTS };
export type { PointId, Kind };
