/**
 * CSS matrix3d that maps an element's box (0,0)–(w,h) onto four screen points.
 * Classic projective mapping: solve each quad as a projective basis, then compose.
 */
type M3 = [number, number, number, number, number, number, number, number, number];
export type Quad = [[number, number], [number, number], [number, number], [number, number]]; // tl, tr, bl, br

function adj(m: M3): M3 {
  return [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ];
}

function mulMM(a: M3, b: M3): M3 {
  const c = new Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) c[3 * i + j] += a[3 * i + k]! * b[3 * k + j]!;
  return c;
}

function mulMV(m: M3, v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function basis(q: Quad): M3 {
  const [[x1, y1], [x2, y2], [x3, y3], [x4, y4]] = q;
  const m: M3 = [x1, x2, x3, y1, y2, y3, 1, 1, 1];
  const v = mulMV(adj(m), [x4, y4, 1]);
  return mulMM(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

export function matrix3dFor(w: number, h: number, dst: Quad): string {
  // order tl, tr, bl, br
  const src: Quad = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  const t = mulMM(basis(dst), adj(basis(src)));
  for (let i = 0; i < 9; i++) t[i] = t[i]! / t[8];
  return `matrix3d(${t[0]},${t[3]},0,${t[6]},${t[1]},${t[4]},0,${t[7]},0,0,1,0,${t[2]},${t[5]},0,${t[8]})`;
}
