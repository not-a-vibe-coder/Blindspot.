import * as THREE from "three";

export type V2 = [number, number];

function signedArea(pts: V2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function centroid(pts: V2[]): V2 {
  // area centroid (stable under vertex drift)
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) return pts[0]!;
  return [cx / (3 * a), cy / (3 * a)];
}

/** Offset a convex polygon inward by `d` (line-offset + neighbour intersection). */
export function insetPolygon(pts: V2[], d: number): V2[] {
  const ccw = signedArea(pts) > 0;
  const n = pts.length;
  const lines: { p: V2; dir: V2 }[] = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % n]!;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const dx = (x2 - x1) / len;
    const dy = (y2 - y1) / len;
    // inward normal: left for CCW, right for CW
    const nx = ccw ? -dy : dy;
    const ny = ccw ? dx : -dx;
    lines.push({ p: [x1 + nx * d, y1 + ny * d], dir: [dx, dy] });
  }
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i - 1 + n) % n]!;
    const b = lines[i]!;
    const cross = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
    if (Math.abs(cross) < 1e-6) {
      out.push(b.p);
      continue;
    }
    const t = ((b.p[0] - a.p[0]) * b.dir[1] - (b.p[1] - a.p[1]) * b.dir[0]) / cross;
    out.push([a.p[0] + a.dir[0] * t, a.p[1] + a.dir[1] * t]);
  }
  return out;
}

/** THREE.Shape of a polygon with every corner rounded by radius r. */
export function roundedShape(pts: V2[], r: number): THREE.Shape {
  const n = pts.length;
  const shape = new THREE.Shape();
  const corner = (i: number) => {
    const v = pts[i]!;
    const prev = pts[(i - 1 + n) % n]!;
    const next = pts[(i + 1) % n]!;
    const lp = Math.hypot(prev[0] - v[0], prev[1] - v[1]);
    const ln = Math.hypot(next[0] - v[0], next[1] - v[1]);
    const rr = Math.min(r, lp * 0.45, ln * 0.45);
    const a: V2 = [v[0] + ((prev[0] - v[0]) / lp) * rr, v[1] + ((prev[1] - v[1]) / lp) * rr];
    const b: V2 = [v[0] + ((next[0] - v[0]) / ln) * rr, v[1] + ((next[1] - v[1]) / ln) * rr];
    return { v, a, b };
  };
  const c0 = corner(0);
  shape.moveTo(c0.b[0], c0.b[1]);
  for (let i = 1; i <= n; i++) {
    const c = corner(i % n);
    shape.lineTo(c.a[0], c.a[1]);
    shape.quadraticCurveTo(c.v[0], c.v[1], c.b[0], c.b[1]);
  }
  return shape;
}

export interface GlassDims {
  radius: number;
  depth: number;
  bevel: number;
  /** half the gap between neighbouring shards */
  halfCut: number;
}

/**
 * A thick glass piece: ExtrudeGeometry of the rounded polygon, outline inset by half
 * the cut (plus the bevel, which grows the outline back out).
 * Returned in piece-local coordinates around `center`; top face at z = depth + bevel.
 */
export function glassGeometry(localPts: V2[], g: GlassDims): THREE.ExtrudeGeometry {
  const outline = insetPolygon(localPts, g.halfCut + g.bevel);
  const shape = roundedShape(outline, Math.max(g.radius - g.bevel, 1));
  return new THREE.ExtrudeGeometry(shape, {
    depth: g.depth,
    bevelEnabled: true,
    bevelThickness: g.bevel,
    bevelSize: g.bevel,
    bevelOffset: 0,
    bevelSegments: 3,
    curveSegments: 6,
    steps: 1,
  });
}

/**
 * The print layer: a flat ShapeGeometry of the piece's outline, UV-mapped to where the
 * piece sits on the page image, so a flying shard takes its slice of the text with it.
 */
export function printGeometry(
  localPts: V2[],
  g: GlassDims,
  center: V2,
  page: { left: number; bottom: number; w: number; h: number },
): THREE.ShapeGeometry {
  const outline = insetPolygon(localPts, g.halfCut);
  const geo = new THREE.ShapeGeometry(roundedShape(outline, g.radius), 6);
  const pos = geo.attributes.position!;
  const uv = geo.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + center[0];
    const wy = pos.getY(i) + center[1];
    uv.setXY(i, (wx - page.left) / page.w, (wy - page.bottom) / page.h);
  }
  uv.needsUpdate = true;
  return geo;
}
