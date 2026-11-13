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
  /** Bonus gap: a small round hole in the local frame (bonusR = 0 means none). */
  bonusX = 0;
  bonusY = 0;
  bonusR = 0;
  /** Set when the ship flies through the bonus gap (the ring then flashes and goes dark). */
  bonusTaken = false;
  bonusFlash = 0;
  private bonusRing: THREE.Mesh;
  private bonusMat: THREE.MeshBasicMaterial;
  angle = 0;
  spin = 0;
  passed = false;
  /** Rim flash after the ship passes (0..1). */
  flash = 0;
  /** Collision warning strength set by the flight aids each frame (0..1). */
  warn = 0;
  private time = 0;
  readonly baseColor = new THREE.Color();

  /** Own copy of the face material, so each wall can fade on its own. */
  private capMaterial: THREE.MeshStandardMaterial;
  /** 1 = solid, 0 = gone. */
  private opacity = 1;

  constructor(capMaterial: THREE.MeshStandardMaterial) {
    this.capMaterial = capMaterial.clone();
    this.rimMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      metalness: 0.1,
      roughness: 0.4,
      emissive: 0xffffff,
      emissiveIntensity: 2.2,
    });
    // Both materials are always in the transparent pass so fading never needs a shader rebuild.
    for (const m of [this.capMaterial, this.rimMaterial]) m.transparent = true;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), [this.capMaterial, this.rimMaterial]);
    // Gold ring on the bonus gap's front edge, a child of the wall so it turns and fades with it.
    this.bonusMat = new THREE.MeshBasicMaterial({ color: BONUS_GOLD.clone(), transparent: true });
    this.bonusRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.09, 8, 40), this.bonusMat);
    this.bonusRing.position.z = CONFIG.obstacles.thickness / 2 + 0.1;
    this.mesh.add(this.bonusRing);
  }

  /** Rebuild the geometry for a new hole. Called only when the obstacle is recycled, never per frame. */
  build(kind: HoleKind, cx: number, cy: number, r: number, angle: number, spin: number, bonus?: { x: number; y: number; r: number }): void {
    this.bonusX = bonus?.x ?? 0;
    this.bonusY = bonus?.y ?? 0;
    this.bonusR = bonus?.r ?? 0;
    this.bonusTaken = false;
    this.bonusFlash = 0;
    this.bonusRing.visible = this.bonusR > 0;
    this.bonusRing.position.x = this.bonusX;
    this.bonusRing.position.y = this.bonusY;
    this.bonusRing.scale.set(this.bonusR, this.bonusR, 1);
    this.kind = kind;
    this.cx = cx;
    this.cy = cy;
    this.r = r;
    this.angle = angle;
    this.spin = spin;
    this.passed = false;
    this.flash = 0;
    this.warn = 0;
    this.setOpacity(1);

    const R = CONFIG.tube.radius + 0.35; // sinks slightly into the wall
    const shapes: THREE.Shape[] = [];
    if (kind === 'circle') {
      const s = new THREE.Shape();
      s.absarc(0, 0, R, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(cx, cy, r, 0, Math.PI * 2, true);
      s.holes.push(hole);
      shapes.push(s);
      if (this.bonusR > 0) s.holes.push(this.bonusPath());
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
      // The bonus hole sits in whichever segment contains it.
      if (this.bonusR > 0) (this.bonusY > cy ? s1 : s2).holes.push(this.bonusPath());
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

  private bonusPath(): THREE.Path {
    const p = new THREE.Path();
    p.absarc(this.bonusX, this.bonusY, this.bonusR, 0, Math.PI * 2, true);
    return p;
  }

  /**
   * Fade the wall out once the ship is fully through its gap, so it never blocks the camera's
   * view of the next wall. Nothing fades before the ship has cleared the wall's back face.
   */
  private fadeFor(shipZ: number): void {
    const C = CONFIG.obstacles;
    const cleared = this.z - C.thickness / 2 - 0.08 - CONFIG.ship.radius; // back face + bevel + ship
    const t = shipZ < cleared ? (cleared - shipZ) / C.fadeDistance : 0;
    this.setOpacity(1 - Math.min(1, t));
  }

  private setOpacity(a: number): void {
    if (a === this.opacity) return;
    this.opacity = a;
    this.capMaterial.opacity = a;
    this.rimMaterial.opacity = a;
    this.bonusMat.opacity = a;
    // A fading wall must not hide what's behind it in the depth buffer.
    const solid = a >= 1;
    this.capMaterial.depthWrite = solid;
    this.rimMaterial.depthWrite = solid;
    this.mesh.visible = a > 0;
  }

  update(dt: number, shipZ: number): void {
    this.fadeFor(shipZ);
    if (this.spin !== 0) {
      this.angle += this.spin * dt;
      this.mesh.rotation.z = this.angle;
    }
    this.mesh.position.z = this.z;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.5);
    this.time += dt;
    // Warning: pulse the rim toward red. The pass flash (white) still wins when it fires.
    const pulse = this.warn > 0 ? this.warn * (0.65 + 0.35 * Math.sin(this.time * 20)) : 0;
    this.rimMaterial.emissive.copy(this.baseColor).lerp(WARN_RED, pulse).lerp(WHITE, this.flash);
    this.rimMaterial.emissiveIntensity = 2.2 + pulse * 2.5 + this.flash * 4;
    // Bonus ring: a slow shimmer while it's on offer; a white flash, then dark, once taken.
    if (this.bonusR > 0) {
      if (this.bonusFlash > 0) this.bonusFlash = Math.max(0, this.bonusFlash - dt * 2);
      const shimmer = this.bonusTaken ? 0.15 : 0.85 + 0.15 * Math.sin(this.time * 6);
      this.bonusMat.color.copy(BONUS_GOLD).multiplyScalar(shimmer).lerp(BONUS_FLASH, this.bonusFlash);
    }
  }

  /** Transform a world (x, y) into this obstacle's local frame (optionally at another rotation). */
  toLocal(x: number, y: number, out: THREE.Vector2, angle = this.angle): THREE.Vector2 {
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    return out.set(x * c - y * s, x * s + y * c);
  }

  /**
   * True if a sphere of radius `margin` at world (x, y) fits through the gap.
   * `angle` lets the flight aids test a spinning slot at the rotation it will have on arrival.
   */
  fits(x: number, y: number, margin: number, angle = this.angle): boolean {
    const p = this.toLocal(x, y, tmp2, angle);
    if (this.kind === 'circle') return Math.hypot(p.x - this.cx, p.y - this.cy) <= this.r - margin;
    return Math.abs(p.y - this.cy) <= this.r - margin;
  }

  /** True if a sphere of radius `margin` at world (x, y) fits through the bonus gap. */
  fitsBonus(x: number, y: number, margin: number, angle = this.angle): boolean {
    if (this.bonusR <= 0) return false;
    const p = this.toLocal(x, y, tmp2, angle);
    return Math.hypot(p.x - this.bonusX, p.y - this.bonusY) <= this.bonusR - margin;
  }

  /** A random world-space point on the bonus gap's ring (for its burst). */
  randomBonusPoint(out: THREE.Vector3): THREE.Vector3 {
    const a = Math.random() * Math.PI * 2;
    const lx = this.bonusX + Math.cos(a) * this.bonusR;
    const ly = this.bonusY + Math.sin(a) * this.bonusR;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return out.set(lx * c - ly * s, lx * s + ly * c, this.z + CONFIG.obstacles.thickness / 2);
  }

  /**
   * Closest point on this wall's solid surface to a point in front of (or inside) it: straight onto
   * the face when lined up with solid wall, or onto the gap's rim when lined up with the gap.
   * Used by the electric-arc cue.
   */
  closestPoint(px: number, py: number, pz: number, out: THREE.Vector3): THREE.Vector3 {
    const half = CONFIG.obstacles.thickness / 2;
    const p = this.toLocal(px, py, tmp2);
    let lx = p.x;
    let ly = p.y;
    let z = this.z + half + 0.08; // the face toward the ship (plus its bevel)
    const r = this.r - 0.08; // visible hole (the bevel narrows it)
    if (this.kind === 'circle') {
      const dx = lx - this.cx;
      const dy = ly - this.cy;
      const d = Math.hypot(dx, dy);
      if (d < r) {
        const k = d > 1e-4 ? r / d : 0;
        lx = this.cx + (d > 1e-4 ? dx * k : r);
        ly = this.cy + dy * k;
        z = THREE.MathUtils.clamp(pz, this.z - half, this.z + half); // the rim's inner surface
      }
    } else if (Math.abs(ly - this.cy) < r) {
      ly = this.cy + Math.sign(ly - this.cy || 1) * r;
      z = THREE.MathUtils.clamp(pz, this.z - half, this.z + half);
    }
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return out.set(lx * c - ly * s, lx * s + ly * c, z);
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
const WARN_RED = new THREE.Color(1, 0.04, 0.02);
/** Bonus gap ring: bright gold, unlike any zone colour or the boost's violet. */
const BONUS_GOLD = new THREE.Color(3.2, 2.2, 0.45);
const BONUS_FLASH = new THREE.Color(4, 4, 3.5);
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
  /** z of the most recently spawned wall (or the run's start), i.e. where the stretch before the next wall begins. */
  private lastSpawnZ = 0;
  /**
   * Called after each wall is placed, with the z where the stretch leading up to it begins.
   * Boost pads use it to put themselves on the tunnel wall in that stretch.
   */
  onSpawn: ((o: Obstacle, index: number, stretchStartZ: number) => void) | null = null;
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
    this.lastSpawnZ = shipZ;
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
        Object.assign(o, { kind, cx, cy, r, angle: 0 });
      } else {
        r = holeR * 0.85; // slot half-height; slots are long, so a bit tighter
        const maxOff = Math.max(0, R - r - 1.2);
        cy = (Math.random() * 2 - 1) * maxOff;
        Object.assign(o, { kind, cx: 0, cy, r, angle });
      }
      o.gapCenter(tmpGap);
      if (tmpGap.distanceTo(this.lastGap) <= maxJump || attempt === 23) break;
    }
    o.build(o.kind, o.cx, o.cy, o.r, o.angle, o.kind === 'slot' ? spin : 0, this.pickBonus(o, holeR));
    o.gapCenter(this.lastGap);
    o.mesh.position.z = o.z;
    this.onSpawn?.(o, n, this.lastSpawnZ);
    this.lastSpawnZ = o.z;
  }

  /**
   * A small bonus hole somewhere on the wall's solid part, well clear of the main gap and the tunnel
   * wall. It shrinks with the main gap. Returns undefined if no spot fits.
   */
  private pickBonus(o: Obstacle, holeR: number): { x: number; y: number; r: number } | undefined {
    const B = CONFIG.obstacles;
    const br = THREE.MathUtils.clamp(holeR * B.bonusScale, B.bonusMinR, B.bonusMaxR);
    const maxR = CONFIG.tube.radius - br - 1.2;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * maxR;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      const clear = o.kind === 'circle' ? Math.hypot(x - o.cx, y - o.cy) - o.r : Math.abs(y - o.cy) - o.r;
      if (clear >= br + B.bonusClearance) return { x, y, r: br };
    }
    return undefined;
  }

  /** Recycle walls that are behind the ship and keep the gap light on the next wall. */
  update(dt: number, shipZ: number): void {
    let next: Obstacle | null = null;
    for (const o of this.items) {
      if (o.z > shipZ + 20) this.respawn(o);
      o.update(dt, shipZ);
      if (o.z < shipZ && (next === null || o.z > next.z)) next = o;
    }
    if (next) {
      next.gapCenter(tmpGap);
      this.gapLight.position.set(tmpGap.x, tmpGap.y, next.z + 2.5);
      this.gapLight.color.copy(next.baseColor);
    }
  }

  /** Distance between the next wall and the one after it (the current spacing). */
  spacingAhead(shipZ: number): number {
    const next = this.nextAhead(shipZ);
    if (!next) return CONFIG.obstacles.startSpacing;
    let after: Obstacle | null = null;
    for (const o of this.items) if (o.z < next.z && (after === null || o.z > after.z)) after = o;
    return after ? next.z - after.z : CONFIG.obstacles.startSpacing;
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
