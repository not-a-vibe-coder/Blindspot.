import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { computeLayout, toSlab, type HeroLayout, type Rect } from "./layout";
import { CELL_IDS, livePattern, type CellId, type Pt } from "./cuts";
import { centroid, glassGeometry, printGeometry, type GlassDims, type V2 } from "./geometry";
import { createGlassMaterial, createGlowUniforms, type GlowUniforms } from "./material";
import { FONT, drawItems, navItems, panelItems, type Item } from "./content";
import type { Quad } from "./homography";

export type PieceId = CellId | "nav";

export interface Piece {
  id: PieceId;
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  print: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  base: V2; // centroid in slab space
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
      piece = { id, group, mesh, print, base: c };
    } else {
      piece.mesh.geometry.dispose();
      piece.print.geometry.dispose();
      piece.mesh.geometry = glassGeo;
      piece.print.geometry = printGeo;
      piece.base = c;
    }
    piece.print.position.z = top + 0.3;
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
    this.update(dt);
    this.scene.updateMatrixWorld();
    this.opts.onFrame?.(this);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  protected update(dt: number) {
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
      p.print.geometry.dispose();
    }
    this.panelSurface.dispose();
    this.navSurface.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
