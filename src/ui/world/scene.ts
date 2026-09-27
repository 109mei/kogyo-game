/**
 * A small low-poly diorama of the company's industrial estate, drawn with
 * three.js. It only reads a WorldDesc (plain data built from the game state)
 * and never touches the simulation. Each owned facility type gets a plot that
 * spirals out from the head office, so the estate visibly grows over the game.
 */
import * as THREE from 'three';

export type Stage = 'manual' | 'machine' | 'auto';

export interface PlotDesc {
  type: string;
  category: string;
  /** facility opened when the plot is tapped */
  fid: number;
  count: number;
  level: number;
  stage: Stage;
  util: number;
  red: boolean;
  /** every facility of this type is still being built */
  constructing: boolean;
  /** some construction work is going on (crane) */
  crane: boolean;
}

export interface WorldDesc {
  plots: PlotDesc[];
  hqLevel: number;
  hqBuilding: boolean;
  trucks: number;
  rail: boolean;
  paused: boolean;
  speed: number;
  night: boolean;
  reduced: boolean;
}

export type Pick = { fid: number } | { hq: true } | null;

const CELL = 2.6;
const PAD = 2.0;
const ROAD = 0.5;
const MAX_SMOKE = 260;
const MAX_TREES = 420;
const MAX_TRUCKS = 12;

const COL = {
  grass: 0x93c26d,
  grassDark: 0x7aab58,
  soil: 0x8a6a4a,
  asphalt: 0x6d7178,
  concrete: 0xd3cec4,
  dirt: 0xc2a57c,
  wall: 0xf0ece4,
  wallGrey: 0xb9c0c8,
  wallBlue: 0x9fb6cc,
  roof: 0x58636f,
  roofRed: 0xb8553d,
  wood: 0xb07a45,
  woodLight: 0xd9b27c,
  steel: 0x8e9aa7,
  rust: 0x9a5534,
  brick: 0xa9573c,
  copper: 0xb87333,
  tree: 0x3f8f4f,
  treeDark: 0x2f7040,
  trunk: 0x7a5230,
  water: 0x4f9fd8,
  yellow: 0xf2b632,
  white: 0xf7f7f3,
  black: 0x3a3d42,
  blue: 0x2a78d6,
  red: 0xd03b3b,
};

const ORE: Record<string, number> = {
  quarry: 0x9d9d98,
  sand_pit: 0xe4ca90,
  clay_pit: 0xbb7a50,
  limestone_mine: 0xe9e7dd,
  silica_mine: 0xf3f1ea,
  coal_mine: 0x3b3b3b,
  iron_mine: 0x8c5b45,
  copper_mine: 0x4f8f7f,
  bauxite_mine: 0xb2633f,
  lithium_mine: 0xc9d6df,
};

const ACCENT: Record<string, number> = {
  machine_parts_factory: 0x2a78d6,
  electrical_parts_factory: 0xeb6834,
  electronics_factory: 0x1baf7a,
  assembly_plant: 0x6c5ce7,
  vehicle_plant: 0xd03b3b,
};

/** deterministic little PRNG for decoration placement */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** plot cells in the order they are handed out: rings around the head office */
function slotOrder(): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 1; r <= 4; r++) {
    const ring: [number, number][] = [];
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) if (Math.max(Math.abs(x), Math.abs(z)) === r) ring.push([x, z]);
    ring.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
    out.push(...ring);
  }
  return out;
}
const SLOTS = slotOrder();

/** shared geometries and materials so hundreds of meshes stay cheap */
class Kit {
  private geos = new Map<string, THREE.BufferGeometry>();
  private mats = new Map<string, THREE.Material>();
  readonly glass = new THREE.MeshLambertMaterial({ color: 0x8fb8de });
  readonly beaconRed = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  readonly beaconCyan = new THREE.MeshBasicMaterial({ color: 0x3fe0d0 });
  readonly flame = new THREE.MeshBasicMaterial({ color: 0xffa530 });
  readonly lines = new THREE.LineBasicMaterial({ color: COL.yellow });

  geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = this.geos.get(key);
    if (!g) {
      g = make();
      this.geos.set(key, g);
    }
    return g as T;
  }

  mat(color: number, side: THREE.Side = THREE.FrontSide): THREE.Material {
    const key = `${color}:${side}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, side });
      this.mats.set(key, m);
    }
    return m;
  }

  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
  }

  /** y is the bottom of the box */
  box(w: number, h: number, d: number, color: number | 'glass', x = 0, y = 0, z = 0): THREE.Mesh {
    const g = this.geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
    return this.mesh(g, color === 'glass' ? this.glass : this.mat(color), x, y + h / 2, z);
  }

  cyl(r: number, h: number, color: number, x = 0, y = 0, z = 0, rTop = r, seg = 12): THREE.Mesh {
    const g = this.geo(`c${r},${rTop},${h},${seg}`, () => new THREE.CylinderGeometry(rTop, r, h, seg));
    return this.mesh(g, this.mat(color), x, y + h / 2, z);
  }

  cone(r: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 8): THREE.Mesh {
    const g = this.geo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
    return this.mesh(g, this.mat(color), x, y + h / 2, z);
  }

  sphere(r: number, color: number, x = 0, y = 0, z = 0, seg = 10, mat?: THREE.Material): THREE.Mesh {
    const g = this.geo(`s${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.7))));
    return this.mesh(g, mat ?? this.mat(color), x, y, z);
  }

  /** gable roof, ridge along x; y is the eaves */
  roof(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
    const g = this.geo(`r${w},${h},${d}`, () => {
      const s = new THREE.Shape();
      s.moveTo(-d / 2, 0);
      s.lineTo(d / 2, 0);
      s.lineTo(0, h);
      s.closePath();
      const e = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
      e.translate(0, 0, -w / 2);
      e.rotateY(Math.PI / 2);
      return e;
    });
    return this.mesh(g, this.mat(color), x, y, z);
  }

  /** one tooth of a saw-tooth factory roof (vertical glazed face towards -z) */
  tooth(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
    const g = this.geo(`t${w},${h},${d}`, () => {
      const s = new THREE.Shape();
      s.moveTo(-d / 2, 0);
      s.lineTo(d / 2, 0);
      s.lineTo(-d / 2, h);
      s.closePath();
      const e = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
      e.translate(0, 0, -w / 2);
      e.rotateY(Math.PI / 2);
      return e;
    });
    return this.mesh(g, this.mat(color), x, y, z);
  }

  /** a log or pipe lying along x */
  bar(r: number, len: number, color: number, x = 0, y = 0, z = 0, alongZ = false): THREE.Mesh {
    const g = this.geo(`p${r},${len},${alongZ}`, () => {
      const c = new THREE.CylinderGeometry(r, r, len, 8);
      if (alongZ) c.rotateX(Math.PI / 2);
      else c.rotateZ(Math.PI / 2);
      return c;
    });
    return this.mesh(g, this.mat(color), x, y, z);
  }

  dispose() {
    for (const g of this.geos.values()) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.glass.dispose();
    this.beaconRed.dispose();
    this.beaconCyan.dispose();
    this.flame.dispose();
    this.lines.dispose();
  }
}

interface Emitter {
  /** local position inside the plot model */
  at: THREE.Vector3;
  kind: 'smoke' | 'dark' | 'steam';
  acc: number;
}

type AnimKind = 'rock' | 'spin' | 'jib' | 'flame' | 'wheel';

interface Plot {
  key: string;
  root: THREE.Group;
  model: THREE.Group;
  emitters: Emitter[];
  anims: { obj: THREE.Object3D; kind: AnimKind; phase: number }[];
  red: THREE.Mesh;
  auto: THREE.Mesh;
  desc: PlotDesc | null;
}

interface Fx {
  emitters: Emitter[];
  anims: { obj: THREE.Object3D; kind: AnimKind; phase: number }[];
}

function emit(fx: Fx, x: number, y: number, z: number, kind: Emitter['kind'] = 'smoke') {
  fx.emitters.push({ at: new THREE.Vector3(x, y, z), kind, acc: Math.random() });
}

// ---- models -------------------------------------------------------------------------------

function tree(k: Kit, g: THREE.Group, x: number, z: number, s: number, dark: boolean, round = false) {
  const q = s < 0.9 ? 0.8 : s < 1.1 ? 1 : 1.2;
  g.add(k.cyl(0.04, 0.16 * q, COL.trunk, x, 0, z, 0.04, 5));
  if (round) g.add(k.sphere(0.2 * q, dark ? COL.treeDark : COL.tree, x, 0.16 * q + 0.15 * q, z, 7));
  else g.add(k.cone(0.2 * q, 0.55 * q, dark ? COL.treeDark : COL.tree, x, 0.1 * q, z, 7));
}

function hut(k: Kit, g: THREE.Group, x: number, z: number, w = 0.55, d = 0.45, h = 0.32, wall = COL.wood, roof = COL.roofRed) {
  g.add(k.box(w, h, d, wall, x, 0, z), k.roof(w + 0.08, 0.2, d + 0.08, roof, x, h, z));
}

function logs(k: Kit, g: THREE.Group, x: number, z: number) {
  g.add(k.bar(0.07, 0.6, COL.wood, x, 0.07, z - 0.08), k.bar(0.07, 0.6, COL.wood, x, 0.07, z + 0.08), k.bar(0.07, 0.6, COL.woodLight, x, 0.19, z));
}

function band(k: Kit, g: THREE.Group, w: number, d: number, y: number, x = 0, z = 0, h = 0.1) {
  g.add(k.box(w + 0.02, h, d + 0.02, 'glass', x, y, z));
}

function chimney(k: Kit, g: THREE.Group, fx: Fx, x: number, z: number, h: number, r = 0.07, color = COL.brick, kind: Emitter['kind'] = 'smoke', smoke = true) {
  g.add(k.cyl(r, h, color, x, 0, z, r * 0.85, 10));
  if (smoke) emit(fx, x, h + 0.05, z, kind);
}

function crane(k: Kit, g: THREE.Group, fx: Fx, x: number, z: number, h = 1.9) {
  g.add(k.box(0.07, h, 0.07, COL.yellow, x, 0, z));
  const jib = new THREE.Group();
  jib.position.set(x, h, z);
  jib.add(k.box(1.1, 0.06, 0.06, COL.yellow, -0.3, 0, 0), k.box(0.18, 0.12, 0.12, COL.black, 0.2, -0.12, 0), k.box(0.015, 0.5, 0.015, COL.black, -0.75, -0.5, 0));
  g.add(jib);
  fx.anims.push({ obj: jib, kind: 'jib', phase: Math.random() * 6 });
}

function truckModel(k: Kit, color = COL.blue): THREE.Group {
  const t = new THREE.Group();
  t.add(k.box(0.3, 0.15, 0.15, COL.white, -0.05, 0.03, 0), k.box(0.1, 0.13, 0.15, color, 0.16, 0.03, 0), k.box(0.36, 0.04, 0.12, COL.black, 0, 0, 0));
  return t;
}

function pumpjack(k: Kit, g: THREE.Group, fx: Fx, x: number, z: number) {
  g.add(k.box(0.9, 0.07, 0.24, COL.steel, x, 0, z), k.box(0.08, 0.5, 0.2, COL.steel, x + 0.05, 0.07, z), k.box(0.14, 0.18, 0.12, COL.rust, x - 0.33, 0.07, z + 0.14));
  const beam = new THREE.Group();
  beam.position.set(x + 0.05, 0.6, z);
  beam.add(k.box(0.9, 0.07, 0.08, COL.black, 0, -0.035, 0), k.box(0.1, 0.22, 0.1, COL.black, 0.45, -0.16, 0));
  g.add(beam);
  fx.anims.push({ obj: beam, kind: 'rock', phase: Math.random() * 6 });
}

function flare(k: Kit, g: THREE.Group, fx: Fx, x: number, z: number, h = 1.1) {
  g.add(k.cyl(0.035, h, COL.steel, x, 0, z, 0.03, 6));
  const f = k.mesh(k.geo('flame', () => new THREE.ConeGeometry(0.07, 0.2, 6)), k.flame, x, h + 0.1, z, false);
  g.add(f);
  fx.anims.push({ obj: f, kind: 'flame', phase: Math.random() * 6 });
}

function pit(k: Kit, g: THREE.Group, fx: Fx, p: PlotDesc) {
  const ore = ORE[p.type] ?? 0x999999;
  g.add(k.box(1.5, 0.1, 1.4, ore, -0.2, 0, -0.2), k.box(1.1, 0.1, 1.0, ore, -0.2, 0.1, -0.2), k.box(0.7, 0.1, 0.6, ore, -0.2, 0.2, -0.2));
  g.add(k.cone(0.32, 0.36, ore, 0.62, 0, 0.6, 7));
  // excavator
  const ex = new THREE.Group();
  ex.position.set(0.55, 0, -0.55);
  ex.add(k.box(0.3, 0.1, 0.22, COL.black, 0, 0, 0), k.box(0.26, 0.12, 0.2, COL.yellow, 0, 0.1, 0), k.box(0.1, 0.12, 0.1, COL.yellow, 0.06, 0.22, 0.04));
  const arm = k.box(0.38, 0.05, 0.05, COL.yellow, -0.2, 0.26, -0.02);
  arm.rotation.z = 0.5;
  ex.add(arm);
  g.add(ex);
  if (p.level >= 1) hut(k, g, -0.65, 0.65, 0.45, 0.35, 0.28, COL.wallGrey, COL.roof);
  if (p.stage !== 'manual') g.add(k.box(0.08, 0.05, 0.75, COL.black, 0.62, 0.3, 0.05));
  void fx;
}

function mine(k: Kit, g: THREE.Group, fx: Fx, p: PlotDesc) {
  const ore = ORE[p.type] ?? 0x777777;
  const cx = -0.4;
  const cz = -0.3;
  for (const [dx, dz] of [
    [-0.14, -0.14],
    [0.14, -0.14],
    [-0.14, 0.14],
    [0.14, 0.14],
  ])
    g.add(k.box(0.05, 1.0, 0.05, COL.rust, cx + dx, 0, cz + dz));
  g.add(k.box(0.36, 0.05, 0.36, COL.rust, cx, 1.0, cz));
  const wheel = k.mesh(k.geo('wheel', () => new THREE.TorusGeometry(0.15, 0.025, 6, 14)), k.mat(COL.black), cx, 1.2, cz);
  g.add(wheel);
  fx.anims.push({ obj: wheel, kind: 'wheel', phase: 0 });
  g.add(k.box(0.55, 0.38, 0.45, COL.wallGrey, 0.35, 0, -0.35), k.roof(0.62, 0.18, 0.52, COL.roof, 0.35, 0.38, -0.35));
  g.add(k.cone(0.4, 0.34, ore, 0.35, 0, 0.5, 8));
  g.add(k.box(0.08, 0.05, 0.62, COL.black, -0.15, 0.25, 0.25));
  if (p.stage !== 'manual') chimney(k, g, fx, 0.55, -0.6, 0.75, 0.05, COL.steel, 'dark');
}

function factory(k: Kit, g: THREE.Group, p: PlotDesc) {
  const accent = ACCENT[p.type] ?? COL.blue;
  const big = p.type === 'vehicle_plant' || p.type === 'assembly_plant';
  const w = big ? 1.9 : 1.7;
  const d = big ? 1.3 : 1.2;
  const h = big ? 0.62 : 0.55;
  const wall = p.type === 'electronics_factory' ? COL.white : COL.wall;
  g.add(k.box(w, h, d, wall, 0, 0, -0.15));
  g.add(k.box(w + 0.02, 0.07, d + 0.02, accent, 0, h - 0.14, -0.15));
  if (p.type === 'electronics_factory') band(k, g, w, d, 0.18, 0, -0.15, 0.12);
  const teeth = 4;
  const td = d / teeth;
  for (let i = 0; i < teeth; i++) g.add(k.tooth(w, 0.2, td, COL.roof, 0, h, -0.15 - d / 2 + td / 2 + i * td));
  g.add(k.box(0.36, 0.3, 0.03, accent, -0.4, 0, -0.15 + d / 2 + 0.01), k.box(0.36, 0.3, 0.03, accent, 0.35, 0, -0.15 + d / 2 + 0.01));
  if (p.type === 'vehicle_plant') {
    const colors = [COL.red, COL.blue, COL.white, COL.yellow];
    colors.forEach((c, i) => g.add(k.box(0.18, 0.1, 0.1, c, -0.75 + i * 0.25, 0, 0.78)));
  } else g.add(k.box(0.3, 0.2, 0.25, COL.woodLight, 0.7, 0, 0.72), k.box(0.3, 0.2, 0.25, COL.woodLight, 0.35, 0, 0.72));
}

function hq(k: Kit, g: THREE.Group, fx: Fx, level: number) {
  if (level <= 1) {
    g.add(k.box(0.85, 0.5, 0.7, COL.wall, 0, 0, 0));
    const r = k.cone(0.64, 0.36, COL.roofRed, 0, 0.5, 0, 4);
    r.rotation.y = Math.PI / 4;
    g.add(r, k.box(0.18, 0.28, 0.03, COL.wood, 0.15, 0, 0.36), k.box(0.2, 0.14, 0.03, 'glass', -0.2, 0.22, 0.36));
  } else if (level === 2) {
    g.add(k.box(1.1, 0.9, 0.9, COL.wall, 0, 0, 0), k.box(1.14, 0.05, 0.94, COL.roof, 0, 0.9, 0));
    band(k, g, 1.1, 0.9, 0.18);
    band(k, g, 1.1, 0.9, 0.58);
  } else if (level === 3) {
    g.add(k.box(1.1, 1.7, 1.0, COL.wallBlue, 0, 0, 0), k.box(1.14, 0.06, 1.04, COL.roof, 0, 1.7, 0));
    for (let i = 0; i < 4; i++) band(k, g, 1.1, 1.0, 0.22 + i * 0.38);
  } else {
    const tower = (x: number, h: number, w: number) => {
      g.add(k.box(w, h, w, 'glass', x, 0, 0), k.box(w + 0.04, 0.08, w + 0.04, COL.roof, x, h, 0));
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        g.add(k.box(0.06, h, 0.06, COL.wallGrey, x + (dx * w) / 2, 0, (dz * w) / 2));
    };
    if (level === 4) tower(0, 2.8, 1.0);
    else if (level === 5) {
      tower(0, 3.1, 0.95);
      g.add(k.box(0.45, 0.6, 1.5, COL.wall, -0.78, 0, 0), k.box(0.45, 0.6, 1.5, COL.wall, 0.78, 0, 0));
      band(k, g, 0.45, 1.5, 0.25, -0.78);
      band(k, g, 0.45, 1.5, 0.25, 0.78);
    } else {
      tower(-0.45, 3.7, 0.7);
      tower(0.45, 3.4, 0.7);
      g.add(k.box(0.3, 0.2, 0.4, COL.wallGrey, 0, 2.5, 0), k.cyl(0.02, 0.8, COL.steel, -0.45, 3.78, 0, 0.01, 4));
    }
  }
  g.add(k.cyl(0.02, 0.95, COL.steel, 0.85, 0, 0.85, 0.02, 4), k.box(0.26, 0.15, 0.01, COL.blue, 0.72, 0.75, 0.85));
  void fx;
}

function buildModel(k: Kit, p: PlotDesc, g: THREE.Group, fx: Fx) {
  const rnd = mulberry(hashStr(p.type));
  const on = p.stage !== 'manual';
  switch (p.type) {
    case 'forestry': {
      const n = Math.min(15, 5 + p.level * 2);
      for (let i = 0; i < n; i++) tree(k, g, -0.95 + rnd() * 1.25, -0.95 + rnd() * 1.9, 0.75 + rnd() * 0.55, rnd() < 0.35);
      logs(k, g, 0.6, -0.45);
      if (p.level >= 1) hut(k, g, 0.6, 0.5);
      if (on) g.add(k.box(0.28, 0.14, 0.18, COL.yellow, 0.55, 0, 0.0), k.box(0.1, 0.12, 0.12, COL.black, 0.63, 0.14, 0.0));
      break;
    }
    case 'rubber_plantation':
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tree(k, g, -0.7 + i * 0.5, -0.7 + j * 0.5, 1, (i + j) % 2 === 0, true);
      hut(k, g, 0.65, 0.65, 0.4, 0.35, 0.26);
      break;
    case 'quarry':
    case 'sand_pit':
    case 'clay_pit':
    case 'limestone_mine':
    case 'silica_mine':
      pit(k, g, fx, p);
      break;
    case 'coal_mine':
    case 'iron_mine':
    case 'copper_mine':
    case 'bauxite_mine':
    case 'lithium_mine':
      mine(k, g, fx, p);
      break;
    case 'water_intake':
      g.add(k.cyl(0.8, 0.03, COL.concrete, -0.2, 0, 0.05, 0.8, 22), k.mesh(k.geo('pond', () => new THREE.CylinderGeometry(0.72, 0.72, 0.04, 22)), k.mat(COL.water), -0.2, 0.03, 0.05, false));
      g.add(k.box(0.45, 0.34, 0.4, COL.wall, 0.62, 0, -0.55), k.roof(0.52, 0.16, 0.47, COL.blue, 0.62, 0.34, -0.55), k.bar(0.05, 0.6, COL.steel, 0.42, 0.08, -0.2, true));
      if (p.level >= 2) g.add(k.cyl(0.04, 0.8, COL.steel, 0.7, 0, 0.6, 0.04, 5), k.cyl(0.22, 0.3, COL.wallBlue, 0.7, 0.8, 0.6));
      break;
    case 'oil_field':
      pumpjack(k, g, fx, -0.3, -0.35);
      if (p.level >= 2) pumpjack(k, g, fx, -0.3, 0.35);
      g.add(k.cyl(0.28, 0.45, COL.white, 0.6, 0, 0.55), k.cyl(0.28, 0.45, COL.white, 0.6, 0, -0.1));
      break;
    case 'gas_field':
      g.add(k.cyl(0.18, 0.14, COL.steel, -0.4, 0, -0.35), k.sphere(0.3, COL.white, -0.4, 0.42, -0.35, 12));
      g.add(k.cyl(0.18, 0.14, COL.steel, 0.2, 0, -0.45), k.sphere(0.3, COL.white, 0.2, 0.42, -0.45, 12));
      g.add(k.box(1.1, 0.05, 0.05, COL.steel, -0.1, 0.1, 0.2));
      flare(k, g, fx, 0.65, 0.55);
      break;
    case 'sawmill':
      g.add(k.box(1.5, 0.55, 0.85, COL.wood, 0, 0, -0.2), k.roof(1.6, 0.3, 0.95, COL.roofRed, 0, 0.55, -0.2));
      logs(k, g, -0.45, 0.6);
      g.add(k.box(0.35, 0.18, 0.3, COL.woodLight, 0.45, 0, 0.6), k.box(0.35, 0.18, 0.3, COL.woodLight, 0.45, 0.18, 0.6));
      if (on) chimney(k, g, fx, 0.55, -0.45, 1.0, 0.05, COL.steel, 'steam');
      break;
    case 'paper_mill':
      g.add(k.box(1.3, 0.7, 0.9, COL.wall, -0.2, 0, -0.1), k.box(1.32, 0.04, 0.92, COL.roof, -0.2, 0.7, -0.1));
      band(k, g, 1.3, 0.9, 0.36, -0.2, -0.1);
      g.add(k.cyl(0.28, 0.5, COL.white, 0.65, 0, 0.6));
      chimney(k, g, fx, 0.65, -0.55, 1.5, 0.08, COL.brick, 'steam', on);
      break;
    case 'ceramics_plant':
      g.add(k.box(1.2, 0.5, 0.8, COL.brick, -0.2, 0, -0.1), k.roof(1.3, 0.25, 0.9, COL.roof, -0.2, 0.5, -0.1));
      chimney(k, g, fx, 0.55, -0.45, 1.0, 0.08, COL.brick, 'smoke', on);
      chimney(k, g, fx, 0.55, 0.15, 0.8, 0.07, COL.brick, 'smoke', on);
      g.add(k.box(0.3, 0.2, 0.3, COL.brick, 0.5, 0, 0.7), k.box(0.3, 0.2, 0.3, COL.brick, 0.1, 0, 0.7));
      break;
    case 'cement_plant':
      for (const x of [-0.65, -0.22, 0.21]) g.add(k.cyl(0.19, 1.1, COL.concrete, x, 0, -0.5), k.cone(0.19, 0.1, COL.concrete, x, 1.1, -0.5, 12));
      g.add(k.box(0.35, 1.4, 0.35, COL.wallGrey, 0.66, 0, -0.45));
      {
        const kiln = k.bar(0.12, 1.4, COL.rust, -0.05, 0.25, 0.35);
        kiln.rotation.z = -0.08;
        g.add(kiln);
      }
      chimney(k, g, fx, 0.75, 0.6, 1.6, 0.07, COL.wallGrey, 'smoke', on);
      break;
    case 'glass_plant':
      g.add(k.box(1.4, 0.6, 0.85, COL.wallBlue, -0.1, 0, -0.15), k.box(1.42, 0.04, 0.87, COL.roof, -0.1, 0.6, -0.15));
      band(k, g, 1.4, 0.85, 0.3, -0.1, -0.15);
      g.add(k.box(0.4, 0.4, 0.4, COL.brick, 0.6, 0, 0.62));
      chimney(k, g, fx, 0.7, -0.55, 1.3, 0.07, COL.brick, 'smoke', on);
      break;
    case 'steel_mill':
      g.add(k.cyl(0.28, 1.3, COL.rust, -0.45, 0, -0.3), k.cone(0.28, 0.3, COL.rust, -0.45, 1.3, -0.3, 12), k.cyl(0.04, 0.4, COL.steel, -0.45, 1.55, -0.3, 0.04, 6));
      for (const x of [0.05, 0.35, 0.65]) g.add(k.cyl(0.13, 1.0, COL.wallGrey, x, 0, -0.62), k.sphere(0.13, COL.wallGrey, x, 1.0, -0.62, 8));
      g.add(k.box(1.3, 0.5, 0.55, COL.steel, 0.1, 0, 0.42), k.roof(1.38, 0.2, 0.62, COL.roof, 0.1, 0.5, 0.42));
      chimney(k, g, fx, 0.85, 0.05, 1.9, 0.08, COL.wallGrey, 'dark', on);
      if (on) emit(fx, -0.45, 1.95, -0.3, 'smoke');
      break;
    case 'nonferrous_smelter':
      g.add(k.box(1.3, 0.6, 0.9, COL.wallGrey, -0.2, 0, 0), k.roof(1.38, 0.25, 0.98, COL.copper, -0.2, 0.6, 0));
      chimney(k, g, fx, 0.66, -0.45, 1.4, 0.07, COL.brick, 'smoke', on);
      chimney(k, g, fx, 0.66, 0.25, 1.2, 0.07, COL.brick, 'dark', on);
      break;
    case 'petrochem_plant':
      g.add(k.cyl(0.1, 1.6, COL.white, -0.65, 0, -0.5), k.cyl(0.08, 1.3, COL.white, -0.35, 0, -0.6), k.cyl(0.12, 1.1, COL.white, -0.05, 0, -0.5));
      g.add(k.cyl(0.12, 0.2, COL.steel, 0.5, 0, -0.35), k.sphere(0.3, COL.white, 0.5, 0.45, -0.35, 12));
      g.add(k.box(1.6, 0.05, 0.1, COL.steel, -0.05, 0.5, 0.1), k.box(0.05, 0.5, 0.05, COL.steel, -0.8, 0, 0.1), k.box(0.05, 0.5, 0.05, COL.steel, 0.7, 0, 0.1));
      g.add(k.cyl(0.25, 0.3, COL.white, -0.45, 0, 0.6), k.cyl(0.25, 0.3, COL.white, 0.1, 0, 0.6));
      flare(k, g, fx, 0.75, 0.65, 1.2);
      break;
    case 'silicon_refinery':
      g.add(k.box(1.5, 0.55, 1.0, COL.white, 0, 0, -0.25), k.box(0.3, 0.12, 0.3, COL.steel, -0.3, 0.55, -0.3), k.box(0.3, 0.12, 0.3, COL.steel, 0.3, 0.55, -0.3));
      band(k, g, 1.5, 1.0, 0.24, 0, -0.25);
      g.add(k.cyl(0.14, 0.6, COL.steel, -0.55, 0, 0.62), k.cyl(0.14, 0.6, COL.steel, -0.2, 0, 0.62));
      chimney(k, g, fx, 0.6, 0.62, 0.9, 0.06, COL.steel, 'steam', on);
      break;
    case 'lithium_refinery':
      g.add(k.box(0.8, 0.03, 0.55, 0x9fe3e0, -0.45, 0, 0.45), k.box(0.8, 0.03, 0.55, 0x7ccfd6, 0.45, 0, 0.45));
      g.add(k.box(1.3, 0.55, 0.7, COL.white, -0.1, 0, -0.45));
      band(k, g, 1.3, 0.7, 0.24, -0.1, -0.45);
      g.add(k.cyl(0.18, 0.6, COL.wallGrey, 0.75, 0, -0.5));
      if (on) emit(fx, -0.3, 0.6, -0.45, 'steam');
      break;
    case 'machine_parts_factory':
    case 'electrical_parts_factory':
    case 'electronics_factory':
    case 'assembly_plant':
    case 'vehicle_plant':
      factory(k, g, p);
      if (on) emit(fx, 0.6, 0.85, -0.5, 'steam');
      break;
    case 'warehouse': {
      g.add(k.box(1.7, 0.55, 1.2, COL.wallBlue, 0, 0, -0.15));
      const arch = k.mesh(
        k.geo('arch', () => {
          const c = new THREE.CylinderGeometry(0.6, 0.6, 1.7, 14, 1, false, 0, Math.PI);
          c.rotateZ(Math.PI / 2);
          return c;
        }),
        k.mat(COL.roof, THREE.DoubleSide),
        0,
        0.55,
        -0.15,
      );
      arch.scale.y = 0.45;
      g.add(arch);
      for (const x of [-0.5, 0, 0.5]) g.add(k.box(0.32, 0.36, 0.03, COL.steel, x, 0, 0.46));
      break;
    }
    case 'logistics_center': {
      g.add(k.box(1.8, 0.5, 1.0, COL.wall, 0, 0, -0.4), k.box(1.82, 0.07, 1.02, 0x1baf7a, 0, 0.4, -0.4));
      for (const x of [-0.6, -0.2, 0.2, 0.6]) g.add(k.box(0.26, 0.26, 0.06, COL.steel, x, 0, 0.12));
      const t1 = truckModel(k, 0x1baf7a);
      t1.position.set(-0.35, 0, 0.55);
      t1.rotation.y = Math.PI / 2;
      const t2 = truckModel(k, 0x1baf7a);
      t2.position.set(0.35, 0, 0.55);
      t2.rotation.y = Math.PI / 2;
      g.add(t1, t2);
      break;
    }
    case 'power_plant': {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 8; i++) {
        const y = (i / 8) * 1.3;
        pts.push(new THREE.Vector2(0.32 + 0.2 * ((y - 0.85) / 0.85) ** 2, y));
      }
      g.add(k.mesh(k.geo('tower', () => new THREE.LatheGeometry(pts, 18)), k.mat(COL.concrete, THREE.DoubleSide), -0.4, 0, -0.3));
      emit(fx, -0.4, 1.35, -0.3, 'steam');
      g.add(k.box(0.9, 0.5, 0.6, COL.wallGrey, 0.4, 0, 0.35), k.roof(0.98, 0.2, 0.68, COL.roof, 0.4, 0.5, 0.35));
      g.add(k.cyl(0.07, 0.8, COL.white, 0.75, 0, -0.55, 0.065, 10), k.cyl(0.065, 0.8, COL.red, 0.75, 0.8, -0.55, 0.06, 10));
      emit(fx, 0.75, 1.65, -0.55, 'smoke');
      break;
    }
    case 'research_lab':
      g.add(k.box(1.3, 0.6, 0.85, COL.white, -0.15, 0, -0.2), k.box(1.32, 0.04, 0.87, COL.roof, -0.15, 0.6, -0.2));
      band(k, g, 1.3, 0.85, 0.12, -0.15, -0.2);
      band(k, g, 1.3, 0.85, 0.38, -0.15, -0.2);
      g.add(k.cyl(0.34, 0.28, COL.white, 0.52, 0, 0.55, 0.34, 16));
      g.add(k.mesh(k.geo('dome', () => new THREE.SphereGeometry(0.34, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), k.mat(COL.wallGrey), 0.52, 0.28, 0.55));
      g.add(k.cyl(0.015, 0.6, COL.steel, -0.65, 0.6, -0.45, 0.01, 4));
      break;
    default:
      g.add(k.box(1.2, 0.5, 0.9, COL.wallGrey, 0, 0, 0), k.roof(1.28, 0.22, 0.98, COL.roof, 0, 0.5, 0));
  }
}

/** scaffolding while the first facility of a type is being built */
function buildSite(k: Kit, g: THREE.Group, fx: Fx) {
  g.add(k.box(1.4, 0.18, 1.0, COL.concrete, -0.1, 0, -0.1));
  const edges = new THREE.LineSegments(k.geo('scaffold', () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.5, 0.8, 1.1, 3, 2, 2))), k.lines);
  edges.position.set(-0.1, 0.4, -0.1);
  g.add(edges);
  crane(k, g, fx, 0.75, 0.65);
}

// ---- the scene ----------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  z: number;
  vy: number;
  age: number;
  life: number;
  size: number;
}

export class WorldScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private kit = new Kit();
  private plots = new Map<string, Plot>();
  private hqPlot: Plot | null = null;
  private groundGroup = new THREE.Group();
  private plotGroup = new THREE.Group();
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private hemi = new THREE.HemisphereLight(0xdfefff, 0x8a7a5a, 1.1);
  private trees: THREE.InstancedMesh;
  private trunks: THREE.InstancedMesh;
  private smoke: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private trucks: THREE.Group[] = [];
  private truckT = 0;
  private train: THREE.Group;
  private trainT = 0;
  private desc: WorldDesc | null = null;
  private occupiedKey = '';
  private loop = { x0: 0, x1: 0, z0: 0, z1: 0 };
  private rail = { z: 0, x0: 0, x1: 0 };
  private target = { cx: 0, cz: 0, r: 4 };
  private view = { cx: 0, cz: 0, r: 4 };
  private azimuth = Math.PI / 4;
  private width = 1;
  private height = 1;
  private dirty = true;
  private time = 0;
  private tmp = new THREE.Object3D();
  private tmpV = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x000000, 0);

    this.sun.position.set(-8, 14, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.add(this.groundGroup, this.plotGroup);

    const k = this.kit;
    this.trees = new THREE.InstancedMesh(k.geo('treeCone', () => new THREE.ConeGeometry(0.2, 0.55, 7).translate(0, 0.375, 0)), k.mat(COL.tree), MAX_TREES);
    this.trunks = new THREE.InstancedMesh(k.geo('treeTrunk', () => new THREE.CylinderGeometry(0.04, 0.04, 0.16, 5).translate(0, 0.08, 0)), k.mat(COL.trunk), MAX_TREES);
    this.trees.castShadow = true;
    this.trees.receiveShadow = true;
    this.trees.count = 0;
    this.trunks.count = 0;
    this.scene.add(this.trees, this.trunks);

    const smokeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false });
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.16, 0), smokeMat, MAX_SMOKE);
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.smoke.setColorAt(0, new THREE.Color(0xffffff));
    this.scene.add(this.smoke);

    for (let i = 0; i < MAX_TRUCKS; i++) {
      const t = truckModel(k, i % 3 === 0 ? COL.red : i % 3 === 1 ? COL.blue : 0x1baf7a);
      t.visible = false;
      t.traverse((o) => ((o as THREE.Mesh).castShadow = false));
      this.trucks.push(t);
      this.scene.add(t);
    }

    this.train = new THREE.Group();
    const loco = k.box(0.5, 0.22, 0.2, COL.red, 0, 0.06, 0);
    this.train.add(loco);
    for (let i = 1; i <= 3; i++) this.train.add(k.box(0.46, 0.18, 0.18, i % 2 ? COL.steel : COL.rust, -i * 0.54, 0.06, 0));
    this.train.visible = false;
    this.scene.add(this.train);
  }

  setSize(w: number, h: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.dirty = true;
  }

  rotate(d: number) {
    this.azimuth += d;
    this.dirty = true;
  }

  update(desc: WorldDesc) {
    const prev = this.desc;
    this.desc = desc;
    if (!prev || prev.night !== desc.night) this.applyLighting(desc.night);
    let changed = false;
    // head office in the middle
    const hqKey = `hq:${desc.hqLevel}:${desc.hqBuilding}`;
    if (!this.hqPlot || this.hqPlot.key !== hqKey) {
      if (this.hqPlot) this.removePlot(this.hqPlot);
      this.hqPlot = this.makePlot(hqKey, null, 0, 0, (g, fx) => {
        hq(this.kit, g, fx, desc.hqLevel);
        if (desc.hqBuilding) crane(this.kit, g, fx, -0.9, 0.8, desc.hqLevel >= 3 ? 3.2 : 2.2);
      });
      this.hqPlot.root.userData.hq = true;
      changed = true;
    }
    const seen = new Set<string>();
    desc.plots.forEach((p, i) => {
      if (i >= SLOTS.length) return;
      seen.add(p.type);
      const key = `${p.type}:${p.level}:${p.stage}:${p.constructing}:${p.crane}:${Math.min(3, p.count)}`;
      const cur = this.plots.get(p.type);
      if (cur && cur.key === key) {
        cur.desc = p;
        cur.root.userData.fid = p.fid;
        return;
      }
      if (cur) this.removePlot(cur);
      const [sx, sz] = SLOTS[i];
      const plot = this.makePlot(key, p, sx * CELL, sz * CELL, (g, fx) => {
        if (p.constructing) buildSite(this.kit, g, fx);
        else {
          buildModel(this.kit, p, g, fx);
          if (p.crane) crane(this.kit, g, fx, 0.95, 0.95, 1.5);
        }
      });
      plot.root.userData.fid = p.fid;
      this.plots.set(p.type, plot);
      changed = true;
    });
    for (const [type, plot] of this.plots) {
      if (!seen.has(type)) {
        this.removePlot(plot);
        this.plots.delete(type);
        changed = true;
      }
    }
    const occ = `${Math.min(desc.plots.length, SLOTS.length)}:${desc.rail}`;
    if (occ !== this.occupiedKey) {
      this.occupiedKey = occ;
      this.rebuildGround(desc.plots.length);
      changed = true;
    }
    if (changed) {
      this.renderer.shadowMap.needsUpdate = true;
      this.dirty = true;
    }
    this.layoutTrucks(desc);
    this.train.visible = desc.rail;
  }

  private makePlot(key: string, p: PlotDesc | null, x: number, z: number, build: (g: THREE.Group, fx: Fx) => void): Plot {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    const model = new THREE.Group();
    const fx: Fx = { emitters: [], anims: [] };
    build(model, fx);
    if (p) {
      const lv = p.constructing ? 1 : p.level;
      const foot = (lv === 0 ? 0.82 : 1) * Math.min(1.12, 1 + 0.05 * (Math.min(3, p.count) - 1));
      const tall = lv === 0 ? 0.82 : Math.min(1.35, 1 + 0.07 * (lv - 1));
      model.scale.set(foot, tall, foot);
      // the pad the plot stands on
      const padColor = p.category === 'extraction' ? (p.type === 'forestry' || p.type === 'rubber_plantation' ? COL.grassDark : COL.dirt) : COL.concrete;
      root.add(this.kit.box(PAD, 0.04, PAD, padColor, 0, 0, 0));
    } else root.add(this.kit.box(PAD, 0.04, PAD, COL.concrete, 0, 0, 0));
    model.position.y = 0.04;
    root.add(model);
    root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(model);
    const top = Math.max(0.6, bb.max.y);
    const red = this.kit.sphere(0.07, 0, 0, top + 0.2, 0, 8, this.kit.beaconRed);
    red.castShadow = false;
    red.visible = false;
    const auto = this.kit.mesh(this.kit.geo('ring', () => new THREE.TorusGeometry(0.2, 0.025, 6, 20).rotateX(Math.PI / 2)), this.kit.beaconCyan, 0, top + 0.14, 0, false);
    auto.visible = false;
    root.add(red, auto);
    this.plotGroup.add(root);
    return { key, root, model, emitters: fx.emitters, anims: fx.anims, red, auto, desc: p };
  }

  private removePlot(p: Plot) {
    this.plotGroup.remove(p.root);
  }

  private applyLighting(night: boolean) {
    if (night) {
      this.sun.color.set(0xaec6ff);
      this.sun.intensity = 0.55;
      this.hemi.color.set(0x6d82b0);
      this.hemi.groundColor.set(0x1d1a14);
      this.hemi.intensity = 0.55;
      this.kit.glass.emissive.set(0xffc766);
      this.kit.glass.emissiveIntensity = 0.85;
    } else {
      this.sun.color.set(0xfff4e0);
      this.sun.intensity = 2.2;
      this.hemi.color.set(0xdfefff);
      this.hemi.groundColor.set(0x8a7a5a);
      this.hemi.intensity = 1.1;
      this.kit.glass.emissive.set(0x000000);
      this.kit.glass.emissiveIntensity = 0;
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  /** grass slab, asphalt yard and trees on the empty cells */
  private rebuildGround(n: number) {
    const k = this.kit;
    for (const c of [...this.groundGroup.children]) {
      this.groundGroup.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    let minX = 0;
    let maxX = 0;
    let minZ = 0;
    let maxZ = 0;
    const occupied = new Set<string>(['0,0']);
    for (let i = 0; i < Math.min(n, SLOTS.length); i++) {
      const [x, z] = SLOTS[i];
      occupied.add(`${x},${z}`);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }

    const m = 1;
    const gx0 = Math.min(minX - m, -2);
    const gx1 = Math.max(maxX + m, 2);
    const gz0 = Math.min(minZ - m, -2);
    const gz1 = Math.max(maxZ + m + 1, 3);
    const W = (gx1 - gx0 + 1) * CELL;
    const D = (gz1 - gz0 + 1) * CELL;
    const cx = ((gx0 + gx1) / 2) * CELL;
    const cz = ((gz0 + gz1) / 2) * CELL;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.6, D), [k.mat(COL.soil), k.mat(COL.soil), k.mat(COL.grass), k.mat(COL.soil), k.mat(COL.soil), k.mat(COL.soil)]);
    slab.position.set(cx, -0.3, cz);
    slab.receiveShadow = true;
    this.groundGroup.add(slab);
    // roads on the grid lines around every row and column of plots
    const rx0 = (minX - 0.5) * CELL - ROAD / 2;
    const rx1 = (maxX + 0.5) * CELL + ROAD / 2;
    const rz0 = (minZ - 0.5) * CELL - ROAD / 2;
    const rz1 = (maxZ + 0.5) * CELL + ROAD / 2;
    const asphalt = k.mat(COL.asphalt);
    for (let z = minZ; z <= maxZ + 1; z++) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(rx1 - rx0, 0.02, ROAD), asphalt);
      road.position.set((rx0 + rx1) / 2, 0.01, (z - 0.5) * CELL);
      road.receiveShadow = true;
      this.groundGroup.add(road);
    }
    for (let x = minX; x <= maxX + 1; x++) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(ROAD, 0.022, rz1 - rz0), asphalt);
      road.position.set((x - 0.5) * CELL, 0.011, (rz0 + rz1) / 2);
      road.receiveShadow = true;
      this.groundGroup.add(road);
    }
    this.loop = { x0: (minX - 0.5) * CELL, x1: (maxX + 0.5) * CELL, z0: (minZ - 0.5) * CELL, z1: (maxZ + 0.5) * CELL };
    // railway along the far edge
    const rz = (gz0 - 0.5) * CELL + 0.55;
    this.rail = { z: rz, x0: (gx0 - 0.5) * CELL, x1: (gx1 + 0.5) * CELL };
    if (this.desc?.rail) {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(W, 0.04, 0.34), k.mat(0x8b8378));
      bed.position.set(cx, 0.02, rz);
      bed.receiveShadow = true;
      this.groundGroup.add(bed);
      for (const off of [-0.07, 0.07]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(W, 0.03, 0.025), k.mat(COL.steel));
        r.position.set(cx, 0.055, rz + off);
        this.groundGroup.add(r);
      }
    }
    // trees on free land
    let t = 0;
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (let x = gx0; x <= gx1; x++) {
      for (let z = gz0; z <= gz1; z++) {
        if (occupied.has(`${x},${z}`)) continue;
        const inside = x >= minX && x <= maxX && z >= minZ && z <= maxZ;
        const rnd = mulberry((x * 73856093) ^ (z * 19349663) ^ 0x5bd1e995);
        const count = inside ? (rnd() < 0.5 ? 1 : 0) : 1 + Math.floor(rnd() * 4);
        for (let i = 0; i < count && t < MAX_TREES; i++) {
          const px = x * CELL + (rnd() - 0.5) * CELL * 0.8;
          const pz = z * CELL + (rnd() - 0.5) * CELL * 0.8;
          if (this.desc?.rail && Math.abs(pz - rz) < 0.45) continue;
          const s = 0.75 + rnd() * 0.6;
          sc.set(s, s, s);
          pos.set(px, 0, pz);
          mtx.compose(pos, q, sc);
          this.trees.setMatrixAt(t, mtx);
          this.trunks.setMatrixAt(t, mtx);
          t++;
        }
      }
    }
    this.trees.count = t;
    this.trunks.count = t;
    this.trees.instanceMatrix.needsUpdate = true;
    this.trunks.instanceMatrix.needsUpdate = true;
    // camera and shadow framing
    const bx0 = Math.min(minX, 0) - 0.5;
    const bx1 = Math.max(maxX, 0) + 0.5;
    const bz0 = Math.min(minZ, 0) - 0.5;
    const bz1 = Math.max(maxZ, 0) + 0.5;
    this.target.cx = ((bx0 + bx1) / 2) * CELL;
    this.target.cz = ((bz0 + bz1) / 2) * CELL;
    this.target.r = (Math.max(bx1 - bx0, bz1 - bz0) / 2) * CELL + 0.6;
    const R = Math.max(W, D) * 0.75;
    const cam = this.sun.shadow.camera;
    cam.left = -R;
    cam.right = R;
    cam.top = R;
    cam.bottom = -R;
    cam.near = 0.5;
    cam.far = 60;
    cam.updateProjectionMatrix();
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - 8, 14, cz + 10);
    this.sun.target.updateMatrixWorld();
  }

  private layoutTrucks(desc: WorldDesc) {
    const built = desc.plots.some((p) => !p.constructing && p.level >= 1);
    const n = built ? Math.min(MAX_TRUCKS, 1 + desc.trucks) : 0;
    this.trucks.forEach((t, i) => (t.visible = i < n));
  }

  /** position on the yard loop for a distance along it */
  private loopAt(d: number): { x: number; z: number; dir: number } {
    const { x0, x1, z0, z1 } = this.loop;
    const w = x1 - x0;
    const h = z1 - z0;
    const per = 2 * (w + h);
    let s = ((d % per) + per) % per;
    if (s < w) return { x: x0 + s, z: z1, dir: 0 };
    s -= w;
    if (s < h) return { x: x1, z: z1 - s, dir: Math.PI / 2 };
    s -= h;
    if (s < w) return { x: x1 - s, z: z0, dir: Math.PI };
    s -= w;
    return { x: x0, z: z0 + s, dir: -Math.PI / 2 };
  }

  /** advance animations; returns true when a frame should be drawn */
  frame(dt: number): boolean {
    const d = this.desc;
    if (!d) return false;
    this.time += dt;
    const running = !d.paused && !d.reduced;
    const pace = d.paused ? 0 : 1 + Math.log2(Math.max(1, d.speed)) * 0.35;
    // camera easing
    const v = this.view;
    const t = this.target;
    const ease = 1 - Math.exp(-dt * 4);
    if (Math.abs(v.cx - t.cx) + Math.abs(v.cz - t.cz) + Math.abs(v.r - t.r) > 0.001) {
      v.cx += (t.cx - v.cx) * ease;
      v.cz += (t.cz - v.cz) * ease;
      v.r += (t.r - v.r) * ease;
      this.dirty = true;
    }
    let moving = false;
    // beacons
    const blink = Math.sin(this.time * 6) > 0;
    const allPlots = this.hqPlot ? [this.hqPlot, ...this.plots.values()] : [...this.plots.values()];
    for (const p of allPlots) {
      const pd = p.desc;
      const redOn = !!pd && pd.red && (d.paused || blink);
      if (p.red.visible !== redOn) {
        p.red.visible = redOn;
        this.dirty = true;
      }
      const autoOn = !!pd && pd.stage === 'auto' && !pd.constructing;
      if (p.auto.visible !== autoOn) {
        p.auto.visible = autoOn;
        this.dirty = true;
      }
      if (autoOn && running) {
        p.auto.rotation.y += dt * 1.5;
        p.auto.scale.setScalar(1 + 0.12 * Math.sin(this.time * 3));
        moving = true;
      }
      if (pd?.red && !d.paused) moving = true;
      const util = pd ? pd.util : 1;
      if (running) {
        for (const a of p.anims) {
          if (a.kind === 'jib') {
            a.phase += dt * 0.4 * pace;
            a.obj.rotation.y = Math.sin(a.phase) * 1.2;
            moving = true;
          } else if (util > 0.02) {
            a.phase += dt * pace * (a.kind === 'rock' ? 2.4 : 3.2);
            if (a.kind === 'rock') a.obj.rotation.z = Math.sin(a.phase) * 0.32;
            else if (a.kind === 'wheel') a.obj.rotation.z = a.phase;
            else if (a.kind === 'spin') a.obj.rotation.y = a.phase;
            else if (a.kind === 'flame') a.obj.scale.set(1, 0.8 + 0.35 * Math.abs(Math.sin(a.phase * 2.3)), 1);
            moving = true;
          }
        }
        // smoke
        if (p.emitters.length && util > 0.02) {
          p.model.updateMatrixWorld();
          for (const e of p.emitters) {
            const rate = (e.kind === 'steam' ? 1.6 : 2.2) * Math.min(1.2, util + 0.15) * pace;
            e.acc += rate * dt;
            while (e.acc >= 1) {
              e.acc -= 1;
              if (this.particles.length >= MAX_SMOKE) break;
              this.tmpV.copy(e.at);
              p.model.localToWorld(this.tmpV);
              this.particles.push({
                x: this.tmpV.x + (Math.random() - 0.5) * 0.06,
                y: this.tmpV.y,
                z: this.tmpV.z + (Math.random() - 0.5) * 0.06,
                vy: 0.35 + Math.random() * 0.15,
                age: 0,
                life: 2.2 + Math.random() * 1.2,
                size: e.kind === 'steam' ? 1.25 : 1,
              });
              this.smokeColor(this.particles.length - 1, e.kind);
            }
          }
        }
      }
    }
    // particles (frozen while paused)
    if (this.particles.length && running) {
      const ps = this.particles;
      for (let i = 0; i < ps.length; i++) {
        const q = ps[i];
        if (running) {
          q.age += dt;
          q.y += q.vy * dt;
          q.x += 0.12 * dt;
          q.z -= 0.05 * dt;
        }
        if (q.age >= q.life) {
          const last = ps.length - 1;
          if (i !== last) {
            ps[i] = ps[last];
            this.copyColor(last, i);
          }
          ps.pop();
          i--;
          continue;
        }
        const f = q.age / q.life;
        const s = q.size * (0.55 + f * 1.8) * (f > 0.75 ? 1 - (f - 0.75) / 0.25 : 1);
        this.tmp.position.set(q.x, q.y, q.z);
        this.tmp.rotation.set(q.age, q.age * 0.7, 0);
        this.tmp.scale.setScalar(Math.max(0.01, s));
        this.tmp.updateMatrix();
        this.smoke.setMatrixAt(i, this.tmp.matrix);
      }
      this.smoke.count = ps.length;
      this.smoke.instanceMatrix.needsUpdate = true;
      if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
      moving = true;
    } else if (!this.particles.length && this.smoke.count) {
      this.smoke.count = 0;
      this.dirty = true;
    }
    // trucks
    if (running) this.truckT += dt * 0.9 * pace;
    const { x0, x1, z0, z1 } = this.loop;
    const per = 2 * (x1 - x0 + (z1 - z0));
    const shown = this.trucks.filter((x) => x.visible).length;
    this.trucks.forEach((tr, i) => {
      if (!tr.visible) return;
      const at = this.loopAt(this.truckT + (i * per) / Math.max(1, shown));
      tr.position.set(at.x, 0.02, at.z);
      tr.rotation.y = -at.dir;
      moving = moving || running;
    });
    // train
    if (this.train.visible) {
      if (running) this.trainT += dt * 1.6 * pace;
      const span = this.rail.x1 - this.rail.x0 + 4;
      const x = this.rail.x0 - 2 + (this.trainT % span);
      this.train.position.set(x, 0.05, this.rail.z);
      this.train.children.forEach((c) => (c.visible = c.getWorldPosition(this.tmpV).x > this.rail.x0 && this.tmpV.x < this.rail.x1));
      moving = moving || running;
    }
    if (moving) this.dirty = true;
    if (!this.dirty) return false;
    this.render();
    return true;
  }

  private smokeColor(i: number, kind: Emitter['kind']) {
    const c = kind === 'steam' ? 0xf7f7f7 : kind === 'dark' ? 0x7d7f84 : 0xc4c6c9;
    this.smoke.setColorAt(i, this.tmpColor.set(c));
  }

  private tmpColor = new THREE.Color();

  private copyColor(from: number, to: number) {
    if (!this.smoke.instanceColor) return;
    this.smoke.getColorAt(from, this.tmpColor);
    this.smoke.setColorAt(to, this.tmpColor);
  }

  render() {
    const v = this.view;
    const aspect = this.width / this.height;
    const halfH = Math.max(v.r * 0.9 + 0.7, (v.r * 1.48) / aspect);
    const cam = this.camera;
    cam.left = -halfH * aspect;
    cam.right = halfH * aspect;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.updateProjectionMatrix();
    const el = 0.62;
    const dist = 40;
    const ty = 0.5;
    cam.position.set(v.cx + Math.sin(this.azimuth) * Math.cos(el) * dist, ty + Math.sin(el) * dist, v.cz + Math.cos(this.azimuth) * Math.cos(el) * dist);
    cam.lookAt(v.cx, ty, v.cz);
    this.renderer.render(this.scene, cam);
    this.dirty = false;
  }

  /** which plot is under a point given in normalized device coordinates */
  pick(nx: number, ny: number): Pick {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = this.raycaster.intersectObjects(this.plotGroup.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o !== this.plotGroup) {
        if (o.userData.hq) return { hq: true };
        if (typeof o.userData.fid === 'number') return { fid: o.userData.fid };
        o = o.parent;
      }
    }
    return null;
  }

  dispose() {
    this.kit.dispose();
    this.smoke.geometry.dispose();
    (this.smoke.material as THREE.Material).dispose();
    this.trees.dispose();
    this.trunks.dispose();
    this.smoke.dispose();
    for (const c of this.groundGroup.children) if (c instanceof THREE.Mesh) c.geometry.dispose();
    this.renderer.dispose();
  }
}
