import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { computeLayout, toSlab, type HeroLayout } from "./layout";
import { CELL_IDS, livePattern, type CellId, type Pt } from "./cuts";
import { centroid, glassGeometry, type GlassDims, type V2 } from "./geometry";
import { createGlassMaterial, createGlowUniforms, type GlowUniforms } from "./material";

export type PieceId = CellId | "nav";

export interface Piece {
  id: PieceId;
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  base: V2; // centroid in slab space
}

export interface HeroOptions {
  onReady?: () => void;
}

/**
 * Blindspot landing hero — a dark page shattered into thick smoked-glass shards.
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

  /** pointer in viewport px; `inside` false once it leaves the window */
  readonly pointer = { x: 0, y: 0, inside: false };
  /** 0..1 fade of the cursor's influence (push, glow) */
  presence = 0;
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
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerdown", this.onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("blur", this.onPointerLeave);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ───────────────────────────── layout ─────────────────────────────

  resize = () => {
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.fov = 30;
    this.camera.position.set(0, 0, H / 2 / Math.tan(THREE.MathUtils.degToRad(15)));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.L = computeLayout(W, H);
    const S = this.L.S;
    this.dims = { radius: 20 * S, depth: 13 * S, bevel: 2.6 * S, halfCut: this.L.cut / 2 };
    this.glow.uScale.value = S;
    this.slab.position.set(this.L.center.x, this.L.center.y, 0);
    this.build();
  };

  /** panel-normalised point → slab space */
  panelToSlab(p: Pt): V2 {
    const { panel } = this.L;
    return toSlab(this.L, panel.x + p[0] * panel.w, panel.y + p[1] * panel.h);
  }

  private navOutline(): V2[] {
    const { nav } = this.L;
    // nav is a single rounded slab; its outline is the full nav rect, inset like every piece
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
    for (const id of CELL_IDS) {
      // outer panel edges grow by half a cut so the inset leaves panel edges flush
      out[id] = pattern[id].map((p) => this.expandEdge(this.panelToSlab(p), p));
    }
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

  private build() {
    for (const p of this.pieces) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      this.slab.remove(p.group);
    }
    this.pieces = [];

    const outlines: [PieceId, V2[]][] = [["nav", this.navOutline()], ...Object.entries(this.cellOutlines())] as [
      PieceId,
      V2[],
    ][];

    for (const [id, pts] of outlines) {
      const c = centroid(pts);
      const local = pts.map(([x, y]) => [x - c[0], y - c[1]] as V2);
      const material = createGlassMaterial(this.glow);
      const mesh = new THREE.Mesh(glassGeometry(local, this.dims), material);
      const group = new THREE.Group();
      group.position.set(c[0], c[1], 0);
      group.add(mesh);
      this.slab.add(group);
      this.pieces.push({ id, group, mesh, base: c });
    }
  }

  /** Swap in fresh cell geometry for the current pattern (~45×/s). */
  private rebuildCells() {
    const outlines = this.cellOutlines();
    for (const piece of this.pieces) {
      if (piece.id === "nav") continue;
      const pts = outlines[piece.id];
      const c = centroid(pts);
      const local = pts.map(([x, y]) => [x - c[0], y - c[1]] as V2);
      piece.mesh.geometry.dispose();
      piece.mesh.geometry = glassGeometry(local, this.dims);
      piece.base = c;
      piece.group.position.x = c[0];
      piece.group.position.y = c[1];
    }
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
    this.update(dt, now / 1000);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  protected update(dt: number, _t: number) {
    this.time += dt;
    this.presence += ((this.pointer.inside ? 1 : 0) - this.presence) * (1 - Math.exp(-dt / 0.25));

    this.rebuildAcc += dt;
    if (this.rebuildAcc >= 1 / GlassHero.REBUILD_HZ) {
      this.rebuildAcc = 0;
      this.rebuildCells();
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
    }
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
