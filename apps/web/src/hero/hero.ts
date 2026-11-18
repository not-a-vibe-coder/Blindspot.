import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { computeLayout, toSlab, type HeroLayout, type Rect } from "./layout";
import { CELL_IDS, livePattern, type CellId, type Pt } from "./cuts";
import { centroid, glassGeometry, printGeometry, roundedShape, type GlassDims, type V2 } from "./geometry";
import { createGlassMaterial, createGlowUniforms, GLASS, type GlowUniforms } from "./material";
import { FONT, drawItems, navItems, panelItems, type Item } from "./content";
import type { Quad } from "./homography";

export type PieceId = CellId | "nav";

export interface Piece {
  id: PieceId;
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  print: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  base: V2; // centroid in slab space
  /** hover spring state: lift (z) and tip (rx, ry) with velocities */
  spring: { z: number; vz: number; rx: number; vrx: number; ry: number; vry: number };
  /** where the pointer hits this piece, in its local frame, normalised to [-1, 1] */
  tip: V2;
  halfSize: V2;
  /** shatter path: outward+down velocity (px/s, slab space), tumble axis/angle, per-piece stagger */
  flight: { v: THREE.Vector3; axis: THREE.Vector3; angle: number; delayOut: number; delayIn: number };
}

export type HeroMode = "gone" | "in" | "assembled" | "out";

const FLIGHT_T = 0.72;
const easeInCubic = (t: number) => t * t * t;
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** small deterministic PRNG so every load shatters the same way */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "← Back" sliver outline in viewport fractions */
const SLIVER: V2[] = [
  [0.147, 0.243],
  [0.252, 0.169],
  [0.287, 0.277],
  [0.151, 0.258],
];

/** k 170, c 19 — springy but settles in ~0.4 s */
const SPRING_K = 170;
const SPRING_C = 19;
const TIP_MAX = 0.24;
const deg = THREE.MathUtils.degToRad;

function spring(x: number, v: number, target: number, dt: number): [number, number] {
  // semi-implicit Euler in two substeps for stability at low frame rates
  const h = dt / 2;
  for (let i = 0; i < 2; i++) {
    v += (SPRING_K * (target - x) - SPRING_C * v) * h;
    x += v * h;
  }
  return [x, v];
}

/** A page image (canvas → texture) that pieces print slices of. */
class PrintSurface {
  readonly canvas = document.createElement("canvas");
  readonly ctx = this.canvas.getContext("2d")!;
  readonly texture = new THREE.CanvasTexture(this.canvas);
  readonly material: THREE.MeshBasicMaterial;
  items: Item[] = [];

  constructor(
    public rect: Rect,
    anisotropy: number,
  ) {
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  }

  layout(rect: Rect, items: Item[]) {
    this.rect = rect;
    this.items = items;
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2.5);
    this.canvas.width = Math.round(rect.w * dpr);
    this.canvas.height = Math.round(rect.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(hover: ReadonlySet<string>) {
    drawItems(this.ctx, this.items, this.rect.w, this.rect.h, hover);
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }
}

export interface HeroOptions {
  onReady?: () => void;
  /** fired after every layout with the items printed on each surface (drives the DOM text layer) */
  onLayout?: (panel: Item[], nav: Item[], L: HeroLayout) => void;
  /** fired every frame after the scene updates, before render */
  onFrame?: (hero: GlassHero) => void;
  /** fired when the hero switches between assembled / flying / gone */
  onMode?: (mode: HeroMode) => void;
}

/**
 * Blindspot landing hero — a dark page shattered into thick smoked-glass shards,
 * with the page content printed on the glass.
 * Camera: perspective fov 30°, placed so 1 world unit = 1 CSS px at z = 0.
 */
export class GlassHero {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 20000);
  readonly slab = new THREE.Group();
  readonly glow: GlowUniforms = createGlowUniforms();

  L!: HeroLayout;
  dims!: GlassDims;
  pieces: Piece[] = [];
  panelSurface: PrintSurface;
  navSurface: PrintSurface;
  hover = new Set<string>();
  /** false while shattered / flying */
  interactive = false;
  mode: HeroMode = "gone";
  private modeT0 = 0;
  private clock = performance.now() / 1000;

  private sliver: {
    group: THREE.Group;
    mesh: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshPhysicalMaterial>;
    state: "hidden" | "growing" | "shown" | "shrinking";
    t0: number;
    tipX: number;
    tipY: number;
  } | null = null;

  /** pointer in viewport px; `inside` false once it leaves the window */
  readonly pointer = { x: 0, y: 0, inside: false };
  /** 0..1 fade of the cursor's influence (push, glow) */
  presence = 0;
  /** smoothed slab tilt (radians) */
  tilt = { x: deg(0.8), y: deg(-1.2) };
  hovered: Piece | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  time = 0;
  private rebuildAcc = 0;
  static REBUILD_HZ = 45;

  private raf = 0;
  private last = 0;
  private disposed = false;
  private pmrem: THREE.PMREMGenerator;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly opts: HeroOptions = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x050507, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene.background = new THREE.Color(0x050507);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;

    // soft white-blue key light from the top-left
    const key = new THREE.DirectionalLight(0xe2eaff, 1.15);
    key.position.set(-0.55, 0.85, 0.9).multiplyScalar(2000);
    this.scene.add(key);
    this.scene.add(this.slab);

    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    this.panelSurface = new PrintSurface({ x: 0, y: 0, w: 1, h: 1 }, aniso);
    this.navSurface = new PrintSurface({ x: 0, y: 0, w: 1, h: 1 }, aniso);

    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerdown", this.onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("blur", this.onPointerLeave);

    this.resize();
    // reprint once Inter is ready (canvas text can't wait on CSS)
    Promise.all([400, 450, 500, 550].map((w) => document.fonts.load(`${w} 32px ${FONT}`)))
      .catch(() => {})
      .then(() => {
        if (this.disposed) return;
        this.resize();
        this.opts.onReady?.();
        this.assemble(); // the page enters with the same fly-in
      });
    this.raf = requestAnimationFrame(this.frame);
  }

  // ───────────────────────────── layout ─────────────────────────────

  resize = () => {
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.position.set(0, 0, H / 2 / Math.tan(THREE.MathUtils.degToRad(15)));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.L = computeLayout(W, H);
    const S = this.L.S;
    this.dims = { radius: 20 * S, depth: 13 * S, bevel: 2.6 * S, halfCut: this.L.cut / 2 };
    this.glow.uScale.value = S;
    this.slab.position.set(this.L.center.x, this.L.center.y, 0);

    this.panelSurface.layout(this.L.panel, panelItems(this.L));
    this.navSurface.layout(this.L.nav, navItems(this.L));
    this.panelSurface.draw(this.hover);
    this.navSurface.draw(this.hover);
    this.build();
    this.opts.onLayout?.(this.panelSurface.items, this.navSurface.items, this.L);
  };

  /**
   * Screen-space corners (tl, tr, bl, br) of a print surface on the glass's top face,
   * through the slab's current tilt — used to map the DOM text layer with matrix3d.
   */
  surfaceQuad(which: "panel" | "nav"): Quad {
    const r = which === "panel" ? this.L.panel : this.L.nav;
    const z = this.dims.depth + this.dims.bevel + 0.3;
    const v = new THREE.Vector3();
    const proj = (x: number, y: number): [number, number] => {
      const [sx, sy] = toSlab(this.L, x, y);
      v.set(sx, sy, z).applyMatrix4(this.slab.matrixWorld).project(this.camera);
      return [((v.x + 1) / 2) * this.L.W, ((1 - v.y) / 2) * this.L.H];
    };
    return [proj(r.x, r.y), proj(r.x + r.w, r.y), proj(r.x, r.y + r.h), proj(r.x + r.w, r.y + r.h)];
  }

  /** panel-normalised point → slab space */
  panelToSlab(p: Pt): V2 {
    const { panel } = this.L;
    return toSlab(this.L, panel.x + p[0] * panel.w, panel.y + p[1] * panel.h);
  }

  /** a print surface's rect in slab space (left, bottom, w, h) for UV mapping */
  private pageOf(r: Rect) {
    const [left, bottom] = toSlab(this.L, r.x, r.y + r.h);
    return { left, bottom, w: r.w, h: r.h };
  }

  private navOutline(): V2[] {
    const { nav } = this.L;
    const h = this.dims.halfCut;
    const [x0, y0] = toSlab(this.L, nav.x - h, nav.y - h);
    const [x1, y1] = toSlab(this.L, nav.x + nav.w + h, nav.y + nav.h + h);
    return [
      [x0, y1],
      [x1, y1],
      [x1, y0],
      [x0, y0],
    ];
  }

  /** pointer in screen-panel coordinates (x right, y down), or null */
  pointerOnPanel(): Pt | null {
    if (!this.pointer.inside) return null;
    const { panel } = this.L;
    return [(this.pointer.x - panel.x) / panel.w, (this.pointer.y - panel.y) / panel.h];
  }

  private cellOutlines(): Record<CellId, V2[]> {
    const pattern = livePattern(this.time, this.pointerOnPanel(), this.presence, this.L.portrait);
    const out = {} as Record<CellId, V2[]>;
    for (const id of CELL_IDS) out[id] = pattern[id].map((p) => this.expandEdge(this.panelToSlab(p), p));
    return out;
  }

  /** Outer edges of the panel are expanded by half the cut so only inner seams get gaps. */
  private expandEdge(v: V2, p: Pt): V2 {
    const h = this.dims.halfCut;
    let [x, y] = v;
    if (p[0] <= 1e-6) x -= h;
    if (p[0] >= 1 - 1e-6) x += h;
    if (p[1] <= 1e-6) y += h;
    if (p[1] >= 1 - 1e-6) y -= h;
    return [x, y];
  }

  /** (Re)make a piece's glass + print geometry for an outline in slab space. */
  private shapePiece(piece: Piece | null, id: PieceId, pts: V2[]): Piece {
    const c = centroid(pts);
    const local = pts.map(([x, y]) => [x - c[0], y - c[1]] as V2);
    const surface = id === "nav" ? this.navSurface : this.panelSurface;
    const glassGeo = glassGeometry(local, this.dims);
    const printGeo = printGeometry(local, this.dims, c, this.pageOf(surface.rect));
    glassGeo.computeBoundingBox();
    const top = glassGeo.boundingBox!.max.z;

    if (!piece) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(glassGeo, createGlassMaterial(this.glow));
      const print = new THREE.Mesh(printGeo, surface.material);
      print.renderOrder = 1;
      group.add(mesh, print);
      this.slab.add(group);
      piece = {
        id,
        group,
        mesh,
        print,
        base: c,
        spring: { z: 0, vz: 0, rx: 0, vrx: 0, ry: 0, vry: 0 },
        tip: [0, 0],
        halfSize: [1, 1],
        flight: this.flightFor(id, c),
      };
    } else {
      piece.mesh.geometry.dispose();
      piece.print.geometry.dispose();
      piece.mesh.geometry = glassGeo;
      piece.print.geometry = printGeo;
      piece.base = c;
    }
    piece.print.position.z = top + 0.3;
    const bb = glassGeo.boundingBox!;
    piece.halfSize = [(bb.max.x - bb.min.x) / 2 || 1, (bb.max.y - bb.min.y) / 2 || 1];
    piece.group.position.x = c[0];
    piece.group.position.y = c[1];
    return piece;
  }

  private build() {
    for (const p of this.pieces) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      p.print.geometry.dispose();
      this.slab.remove(p.group);
    }
    this.pieces = [this.shapePiece(null, "nav", this.navOutline())];
    const outlines = this.cellOutlines();
    for (const id of CELL_IDS) this.pieces.push(this.shapePiece(null, id, outlines[id]));
    this.buildSliver();
    this.applyFlight();
  }

  /**
   * Each piece gets an outward + downward velocity, 420–800·S toward the camera,
   * and 2.0–3.6 rad of tumble about a random axis. Nav leaves first.
   */
  private flightFor(id: PieceId, c: V2): Piece["flight"] {
    const S = this.L.S;
    const order = id === "nav" ? 0 : 1 + CELL_IDS.indexOf(id as CellId);
    const r = prng(order * 7919 + 17);
    const len = Math.hypot(c[0], c[1]) || 1;
    const out = 520 + r() * 420;
    const v = new THREE.Vector3(
      (c[0] / len) * out * S * 1.4 + (r() - 0.5) * 160 * S,
      (c[1] / len) * out * S * 0.9 - (220 + r() * 260) * S,
      (420 + r() * 380) * S,
    );
    const axis = new THREE.Vector3(r() - 0.5, r() - 0.5, (r() - 0.5) * 0.6).normalize();
    return { v, axis, angle: 2 + r() * 1.6, delayOut: order * 0.035, delayIn: order * 0.03 };
  }

  private buildSliver() {
    if (this.sliver) {
      this.sliver.mesh.geometry.dispose();
      this.sliver.mesh.material.dispose();
      this.scene.remove(this.sliver.group);
    }
    const { W, H } = this.L;
    const k = W / 1918;
    const world = SLIVER.map(([fx, fy]) => [(fx - 0.5) * W, (0.5 - fy) * H] as V2);
    const c = centroid(world);
    const local = world.map(([x, y]) => [x - c[0], y - c[1]] as V2);
    const geo = new THREE.ExtrudeGeometry(roundedShape(local, 9 * k), {
      depth: 11 * k,
      bevelEnabled: true,
      bevelThickness: 2.4 * k,
      bevelSize: 1.8 * k,
      bevelSegments: 3,
      curveSegments: 6,
    });
    const mat = createGlassMaterial(null, 0.35);
    mat.envMapIntensity = 1.7; // bright bevel
    const mesh = new THREE.Mesh(geo, mat);
    const group = new THREE.Group();
    group.position.set(c[0], c[1], 40 * k);
    group.add(mesh);
    const prev = this.sliver;
    group.scale.setScalar(prev && prev.state === "shown" ? 1 : 0.0001);
    group.visible = !!prev && prev.state !== "hidden";
    this.scene.add(group);
    this.sliver = { group, mesh, state: prev?.state ?? "hidden", t0: prev?.t0 ?? 0, tipX: 0, tipY: 0 };
  }

  /** Send every piece flying ("How it works →"). */
  shatter() {
    if (this.mode !== "assembled") return;
    this.setMode("out");
    if (this.sliver) {
      this.sliver.state = "growing";
      this.sliver.t0 = this.clock;
    }
  }

  /** Fly the pieces back (Back, and the initial page load). */
  assemble() {
    if (this.mode === "assembled" || this.mode === "in") return;
    this.setMode("in");
    if (this.sliver && this.sliver.state !== "hidden") {
      this.sliver.state = "shrinking";
      this.sliver.t0 = this.clock;
    }
  }

  private setMode(m: HeroMode) {
    this.mode = m;
    this.modeT0 = this.clock;
    this.interactive = m === "assembled";
    this.opts.onMode?.(m);
  }

  /** Flight progress of a piece: 0 = in place, 1 = fully flown (can dip < 0 on the overshoot). */
  private flightProgress(p: Piece): number {
    const el = this.clock - this.modeT0;
    switch (this.mode) {
      case "assembled":
        return 0;
      case "gone":
        return 1;
      case "out":
        return easeInCubic(clamp01((el - p.flight.delayOut) / FLIGHT_T));
      case "in":
        return 1 - easeOutBack(clamp01((el - p.flight.delayIn) / FLIGHT_T));
    }
  }

  private updateMode() {
    const el = this.clock - this.modeT0;
    const maxDelay = 0.035 * CELL_IDS.length;
    if (this.mode === "out" && el > FLIGHT_T + maxDelay) this.setMode("gone");
    if (this.mode === "in" && el > FLIGHT_T + maxDelay) this.setMode("assembled");
  }

  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpE = new THREE.Euler();

  /** Position every piece: base + flight path + hover spring. */
  private applyFlight() {
    const g = 1800 * this.L.S;
    for (const p of this.pieces) {
      const s = this.flightProgress(p);
      const t = s * FLIGHT_T;
      const { v, axis, angle } = p.flight;
      p.group.position.set(p.base[0] + v.x * t, p.base[1] + v.y * t - 0.5 * g * t * t, p.spring.z + v.z * t);
      this.tmpQ.setFromAxisAngle(axis, angle * s);
      this.tmpQ2.setFromEuler(this.tmpE.set(p.spring.rx, p.spring.ry, 0));
      p.group.quaternion.copy(this.tmpQ).multiply(this.tmpQ2);
      p.group.visible = this.mode !== "gone";
    }
  }

  /** The "← Back" sliver: grows in .3 s after the shatter, idles with a wobble, tips toward the pointer. */
  private updateSliver(dt: number) {
    const sl = this.sliver;
    if (!sl) return;
    const el = this.clock - sl.t0;
    let scale = 0;
    if (sl.state === "growing") {
      scale = easeOutBack(clamp01((el - 0.3) / 0.45));
      if (el > 0.75) sl.state = "shown";
    } else if (sl.state === "shown") scale = 1;
    else if (sl.state === "shrinking") {
      scale = 1 - easeInCubic(clamp01(el / 0.3));
      if (el > 0.3) sl.state = "hidden";
    }
    sl.group.visible = scale > 0.001;
    sl.group.scale.setScalar(Math.max(scale, 0.0001));
    if (!sl.group.visible) return;

    // hover tip toward the pointer (up to .14 rad)
    let tx = 0;
    let ty = 0;
    if (this.pointer.inside) {
      this.ndc.set((this.pointer.x / this.L.W) * 2 - 1, -(this.pointer.y / this.L.H) * 2 + 1);
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const hit = this.raycaster.intersectObject(sl.mesh, false)[0];
      if (hit) {
        const local = sl.group.worldToLocal(hit.point.clone());
        sl.mesh.geometry.computeBoundingBox();
        const bb = sl.mesh.geometry.boundingBox!;
        tx = THREE.MathUtils.clamp(local.x / ((bb.max.x - bb.min.x) / 2), -1, 1);
        ty = THREE.MathUtils.clamp(local.y / ((bb.max.y - bb.min.y) / 2), -1, 1);
      }
    }
    const k = 1 - Math.exp(-dt / 0.12);
    sl.tipX += (-ty * 0.14 - sl.tipX) * k;
    sl.tipY += (tx * 0.14 - sl.tipY) * k;
    const w = this.clock * Math.PI * 2;
    sl.group.rotation.set(0.08 + 0.03 * Math.sin(w * 0.9) + sl.tipX, -0.16 + 0.04 * Math.sin(w * 1.1 + 1.3) + sl.tipY, 0);
  }

  /** Swap in fresh cell geometry for the current pattern (~45×/s). */
  private rebuildCells() {
    const outlines = this.cellOutlines();
    for (const piece of this.pieces) if (piece.id !== "nav") this.shapePiece(piece, piece.id, outlines[piece.id]);
  }

  /** Reprint the page image when hover state on a printed control changes. */
  setHover(key: string, on: boolean) {
    if (on === this.hover.has(key)) return;
    if (on) this.hover.add(key);
    else this.hover.delete(key);
    (key.startsWith("nav") ? this.navSurface : this.panelSurface).draw(this.hover);
  }

  // ───────────────────────────── input ─────────────────────────────

  private onPointerMove = (e: PointerEvent) => {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.inside = true;
  };

  private onPointerLeave = () => {
    this.pointer.inside = false;
  };

  // ───────────────────────────── loop ─────────────────────────────

  private frame = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min((now - (this.last || now)) / 1000, 1 / 20);
    this.last = now;
    // timelines (fly-in, shatter, sliver) run on wall-clock time so a slow frame rate
    // never stretches them; springs and smoothing use the capped dt
    this.clock = now / 1000;
    this.update(dt);
    this.opts.onFrame?.(this);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  protected update(dt: number) {
    this.time += dt;
    this.updateMode();
    this.presence += ((this.pointer.inside ? 1 : 0) - this.presence) * (1 - Math.exp(-dt / 0.25));

    this.rebuildAcc += dt;
    if (this.rebuildAcc >= 1 / GlassHero.REBUILD_HZ) {
      this.rebuildAcc = 0;
      this.rebuildCells();
    }

    this.updateTilt(dt);
    this.slab.updateMatrixWorld(true);
    this.updateHover();
    this.updatePieces(dt);
    this.applyFlight();
    this.updateSliver(dt);
  }

  /**
   * The block rotates as if pressed at the pointer:
   *   rotateY = x·7° − 1.2°, rotateX = −y·5.5° + .8°   (x right, y up, in [-1, 1])
   * smoothed with a 0.3 s exponential, easing back to rest when the pointer leaves.
   */
  private updateTilt(dt: number) {
    const { W, H } = this.L;
    const x = this.pointer.inside ? (this.pointer.x / W) * 2 - 1 : 0;
    const y = this.pointer.inside ? -((this.pointer.y / H) * 2 - 1) : 0;
    const k = 1 - Math.exp(-dt / 0.3);
    this.tilt.y += (deg(x * 7 - 1.2) - this.tilt.y) * k;
    this.tilt.x += (deg(-y * 5.5 + 0.8) - this.tilt.x) * k;
    this.slab.rotation.set(this.tilt.x, this.tilt.y, 0);
  }

  /** Raycast the piece under the pointer and aim the cursor glow at the hit. */
  private updateHover() {
    let hit: THREE.Intersection | null = null;
    if (this.pointer.inside && this.interactive) {
      this.ndc.set((this.pointer.x / this.L.W) * 2 - 1, -(this.pointer.y / this.L.H) * 2 + 1);
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const hits = this.raycaster.intersectObjects(
        this.pieces.map((p) => p.mesh),
        false,
      );
      hit = hits[0] ?? null;
    }
    this.hovered = hit ? (this.pieces.find((p) => p.mesh === hit!.object) ?? null) : null;

    if (hit && this.hovered) {
      const local = this.hovered.group.worldToLocal(hit.point.clone());
      const [hx, hy] = this.hovered.halfSize;
      this.hovered.tip = [THREE.MathUtils.clamp(local.x / hx, -1, 1), THREE.MathUtils.clamp(local.y / hy, -1, 1)];
      this.glow.uPointer.value.copy(hit.point);
    } else if (this.pointer.inside) {
      // between shards: keep the glow on the slab plane under the pointer
      this.ndc.set((this.pointer.x / this.L.W) * 2 - 1, -(this.pointer.y / this.L.H) * 2 + 1);
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(this.slab.quaternion);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, this.slab.position);
      this.raycaster.ray.intersectPlane(plane, this.glow.uPointer.value);
    }
    this.glow.uGlow.value = this.presence * (this.interactive ? 1 : 0);
  }

  /** Hovered piece springs up toward the camera and tips; neighbours stay put. */
  private updatePieces(dt: number) {
    const S = this.L.S;
    for (const p of this.pieces) {
      const on = p === this.hovered;
      const lift = p.id === "nav" ? 32 * S : 50 * S;
      const s = p.spring;
      [s.z, s.vz] = spring(s.z, s.vz, on ? lift : 0, dt);
      [s.ry, s.vry] = spring(s.ry, s.vry, on ? p.tip[0] * TIP_MAX : 0, dt);
      [s.rx, s.vrx] = spring(s.rx, s.vrx, on ? -p.tip[1] * TIP_MAX : 0, dt);


      // sheen: iridescence .55 → 1.0 and envMapIntensity 1 → 1.9 while hovered
      const h = THREE.MathUtils.clamp(s.z / lift, 0, 1);
      p.mesh.material.iridescence = GLASS.iridescence + (GLASS.iridescenceHover - GLASS.iridescence) * h;
      p.mesh.material.envMapIntensity = GLASS.envMapIntensity + (GLASS.envMapIntensityHover - GLASS.envMapIntensity) * h;
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerdown", this.onPointerMove);
    document.documentElement.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("blur", this.onPointerLeave);
    for (const p of this.pieces) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      p.print.geometry.dispose();
    }
    if (this.sliver) {
      this.sliver.mesh.geometry.dispose();
      this.sliver.mesh.material.dispose();
    }
    this.panelSurface.dispose();
    this.navSurface.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
