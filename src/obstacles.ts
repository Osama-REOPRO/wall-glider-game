import * as THREE from 'three';
import { CONFIG } from './config';
import { createObstacleMaps } from './textures';

export type HoleKind = 'circle' | 'slot';

/** One wall across the tube with a gap the ship has to fly through. */
export class Obstacle {
  readonly mesh: THREE.Mesh;
  readonly rimMaterial: THREE.MeshStandardMaterial;
  z = 0;
  kind: HoleKind = 'circle';
  /** Circle hole: centre and radius in the obstacle's local frame. Slot: cy is the offset, r the half-height. */
  cx = 0;
  cy = 0;
  r = 2;
  angle = 0;
  spin = 0;
  passed = false;
  /** Rim flash after the ship passes (0..1). */
  flash = 0;
  readonly baseColor = new THREE.Color();

  constructor(capMaterial: THREE.MeshStandardMaterial) {
    this.rimMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      metalness: 0.1,
      roughness: 0.4,
      emissive: 0xffffff,
      emissiveIntensity: 2.2,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), [capMaterial, this.rimMaterial]);
  }

  /** Rebuild the geometry for a new hole. Called only when the obstacle is recycled, never per frame. */
  build(kind: HoleKind, cx: number, cy: number, r: number, angle: number, spin: number): void {
    this.kind = kind;
    this.cx = cx;
    this.cy = cy;
    this.r = r;
    this.angle = angle;
    this.spin = spin;
    this.passed = false;
    this.flash = 0;

    const R = CONFIG.tube.radius + 0.35; // sinks slightly into the wall
    const shapes: THREE.Shape[] = [];
    if (kind === 'circle') {
      const s = new THREE.Shape();
      s.absarc(0, 0, R, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(cx, cy, r, 0, Math.PI * 2, true);
      s.holes.push(hole);
      shapes.push(s);
    } else {
      // Two circular segments, above and below a horizontal band (rotated by `angle`).
      const top = cy + r;
      const bottom = cy - r;
      const t0 = Math.asin(THREE.MathUtils.clamp(top / R, -1, 1));
      const s1 = new THREE.Shape();
      s1.moveTo(R * Math.cos(t0), top);
      s1.absarc(0, 0, R, t0, Math.PI - t0, false);
      s1.lineTo(R * Math.cos(t0), top);
      shapes.push(s1);
      const b0 = Math.asin(THREE.MathUtils.clamp(bottom / R, -1, 1));
      const s2 = new THREE.Shape();
      s2.moveTo(-R * Math.cos(b0), bottom);
      s2.absarc(0, 0, R, Math.PI - b0, Math.PI * 2 + b0, false);
      s2.lineTo(-R * Math.cos(b0), bottom);
      shapes.push(s2);
    }

    const depth = CONFIG.obstacles.thickness;
    const geo = new THREE.ExtrudeGeometry(shapes, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 1,
      curveSegments: 40,
    });
    geo.translate(0, 0, -depth / 2);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    this.mesh.rotation.z = angle;
  }

  update(dt: number): void {
    if (this.spin !== 0) {
      this.angle += this.spin * dt;
      this.mesh.rotation.z = this.angle;
    }
    this.mesh.position.z = this.z;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.5);
    this.rimMaterial.emissive.copy(this.baseColor).lerp(WHITE, this.flash);
    this.rimMaterial.emissiveIntensity = 2.2 + this.flash * 4;
  }

  /** Transform a world (x, y) into this obstacle's local frame. */
  toLocal(x: number, y: number, out: THREE.Vector2): THREE.Vector2 {
    const c = Math.cos(-this.angle);
    const s = Math.sin(-this.angle);
    return out.set(x * c - y * s, x * s + y * c);
  }

  /** True if a sphere of radius `margin` at world (x, y) fits through the gap. */
  fits(x: number, y: number, margin: number): boolean {
    const p = this.toLocal(x, y, tmp2);
    if (this.kind === 'circle') return Math.hypot(p.x - this.cx, p.y - this.cy) <= this.r - margin;
    return Math.abs(p.y - this.cy) <= this.r - margin;
  }

  /** World-space centre of the gap (used by the attract-mode autopilot). */
  gapCenter(out: THREE.Vector2): THREE.Vector2 {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const lx = this.kind === 'circle' ? this.cx : 0;
    const ly = this.cy;
    return out.set(lx * c - ly * s, lx * s + ly * c);
  }

  /** A random world-space point on the gap's rim (for the pass burst). */
  randomRimPoint(out: THREE.Vector3): THREE.Vector3 {
    let lx: number;
    let ly: number;
    if (this.kind === 'circle') {
      const a = Math.random() * Math.PI * 2;
      lx = this.cx + Math.cos(a) * this.r;
      ly = this.cy + Math.sin(a) * this.r;
    } else {
      const R = CONFIG.tube.radius;
      ly = this.cy + (Math.random() < 0.5 ? this.r : -this.r);
      const half = Math.sqrt(Math.max(0, R * R - ly * ly));
      lx = (Math.random() * 2 - 1) * half;
    }
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return out.set(lx * c - ly * s, lx * s + ly * c, this.z);
  }
}

const WHITE = new THREE.Color(1, 1, 1);
const tmp2 = new THREE.Vector2();
const tmpGap = new THREE.Vector2();

/** Accent palettes. The zone changes every 10 rings. */
export const ZONES = [
  { tube: new THREE.Color(0x3fd8ff), rim: new THREE.Color(0xff5a2a) },
  { tube: new THREE.Color(0xff3fd2), rim: new THREE.Color(0x40ffb0) },
  { tube: new THREE.Color(0xffb13f), rim: new THREE.Color(0x4f7dff) },
  { tube: new THREE.Color(0x5bff6a), rim: new THREE.Color(0xff3f6a) },
];

/** Pool of obstacles that recycles walls from behind the ship to the far end. */
export class Obstacles {
  readonly group = new THREE.Group();
  readonly items: Obstacle[] = [];
  /** Light that sits in the next gap, coloured like its rim, so the walls ahead glow around it. */
  readonly gapLight: THREE.PointLight;
  private spawned = 0;
  private nextZ = 0;
  private lastGap = new THREE.Vector2();

  constructor() {
    const maps = createObstacleMaps();
    maps.map.repeat.set(0.25, 0.25);
    maps.normalMap.repeat.set(0.25, 0.25);
    const capMat = new THREE.MeshStandardMaterial({
      map: maps.map,
      normalMap: maps.normalMap,
      metalness: 0.45,
      roughness: 0.55,
    });
    for (let i = 0; i < CONFIG.obstacles.poolSize; i++) {
      const o = new Obstacle(capMat);
      this.items.push(o);
      this.group.add(o.mesh);
    }
    this.gapLight = new THREE.PointLight(0xff5a2a, 110, 80, 1.4);
    this.group.add(this.gapLight);
  }

  reset(shipZ: number): void {
    this.spawned = 0;
    this.nextZ = shipZ - CONFIG.obstacles.firstAt;
    this.lastGap.set(0, 0);
    for (const o of this.items) this.respawn(o);
  }

  /** Hole size and spacing tighten with every ring spawned. */
  private respawn(o: Obstacle): void {
    const C = CONFIG.obstacles;
    const n = this.spawned++;
    const spacing = Math.max(C.minSpacing, C.startSpacing - n * C.spacingPerRing);
    const holeR = Math.max(C.minHole, C.startHole - n * C.holePerRing);
    const R = CONFIG.tube.radius;
    o.z = this.nextZ;
    this.nextZ -= spacing;

    const zone = ZONES[Math.floor(n / 10) % ZONES.length];
    o.baseColor.copy(zone.rim);

    // Keep consecutive gaps reachable: the lateral jump is capped relative to the spacing.
    const maxJump = Math.min(R * 1.6, spacing * 0.3);
    const kind: HoleKind = n < 2 ? 'circle' : Math.random() < 0.45 ? 'slot' : 'circle';
    const spin = kind === 'slot' && n > 8 && Math.random() < 0.4 ? (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.35) : 0;
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      let cx = 0;
      let cy = 0;
      let r = holeR;
      if (kind === 'circle') {
        const maxOff = Math.max(0, R - r - 1);
        const off = n === 0 ? 0 : Math.sqrt(Math.random()) * maxOff;
        cx = Math.cos(angle) * off;
        cy = Math.sin(angle) * off;
        o.build('circle', cx, cy, r, 0, 0);
      } else {
        r = holeR * 0.85; // slot half-height; slots are long, so a bit tighter
        const maxOff = Math.max(0, R - r - 1.2);
        cy = (Math.random() * 2 - 1) * maxOff;
        o.build('slot', 0, cy, r, angle, spin);
      }
      o.gapCenter(tmpGap);
      if (tmpGap.distanceTo(this.lastGap) <= maxJump || attempt === 23) break;
    }
    o.gapCenter(this.lastGap);
    o.mesh.position.z = o.z;
  }

  /** Recycle walls that are behind the ship and keep the gap light on the next wall. */
  update(dt: number, shipZ: number): void {
    let next: Obstacle | null = null;
    for (const o of this.items) {
      if (o.z > shipZ + 20) this.respawn(o);
      o.update(dt);
      if (o.z < shipZ && (next === null || o.z > next.z)) next = o;
    }
    if (next) {
      next.gapCenter(tmpGap);
      this.gapLight.position.set(tmpGap.x, tmpGap.y, next.z + 2.5);
      this.gapLight.color.copy(next.baseColor);
    }
  }

  /** The nearest wall still ahead of the ship. */
  nextAhead(shipZ: number): Obstacle | null {
    let next: Obstacle | null = null;
    for (const o of this.items) if (o.z < shipZ && (next === null || o.z > next.z)) next = o;
    return next;
  }

  get spawnedCount(): number {
    return this.spawned;
  }
}
