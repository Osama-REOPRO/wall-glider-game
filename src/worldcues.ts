import * as THREE from 'three';
import { CONFIG } from './config';
import { GAP_GLSL, gapUniforms, setGapUniforms, type AidSettings, type Prediction } from './aids';
import { BEVEL } from './collision';
import type { Obstacle, Obstacles } from './obstacles';
import type { Particles } from './particles';
import type { Ship } from './ship';
import { createGlowTexture } from './textures';

/**
 * Optional in-world proximity cues, each toggled separately in the Aids panel (In world group).
 * None of them is an interface overlay: they are light, glow, electricity and dust in the scene.
 *
 * - ElectricArcs: lightning between the ship and the nearest surface (the next wall or the tunnel).
 * - Headlight:    a forward spotlight; its pool on the wall ahead tightens and brightens as you close in.
 * - HeatGlow:     the wall glows where the ship is lined up with it, from a faint haze to a hot spot.
 * - BowWave:      dust pushed ahead of the ship that splashes where the ship would hit.
 */

export interface CueFrame {
  dt: number;
  ship: Ship;
  obstacles: Obstacles;
  prediction: Prediction | null;
  camera: THREE.Camera;
  aids: AidSettings;
}

/** Offset from a wall's centre to its visible front face (half the slab plus the bevel). */
const FACE = CONFIG.obstacles.thickness / 2 + BEVEL;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

/** Distance from the ship straight down the tunnel to the next wall's face (null if none). */
function wallAhead(ship: Ship, obstacles: Obstacles): { o: Obstacle; dist: number } | null {
  const o = obstacles.nextAhead(ship.position.z);
  if (!o) return null;
  return { o, dist: ship.position.z - (o.z + FACE) };
}

// --------------------------------------------------------------------------------------------
// Electric arcs

const ARC_SEGMENTS = 16; // per bolt (midpoint displacement, 4 levels)
const MAX_BOLTS = 6;

/**
 * Lightning between the ship and the closest point of the nearest surface. Bolts appear inside a
 * range and get thicker, brighter and more numerous as the gap closes. Lined up with a wall's gap, the
 * closest surface is the rim, so the arcs reach for the edge you're about to scrape.
 */
export class ElectricArcs {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;
  /** Bolt paths, regenerated a few times a second so the bolts flicker. */
  private paths: THREE.Vector3[][] = [];
  private boltK: number[] = [];
  private regen = 0;
  private particles: Particles;
  private sparkColor = new THREE.Color(1.6, 2.2, 3.2);
  private sparkEnd = new THREE.Color(0.2, 0.3, 1.2);

  constructor(particles: Particles) {
    this.particles = particles;
    const verts = MAX_BOLTS * ARC_SEGMENTS * 6;
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    for (let i = 0; i < MAX_BOLTS; i++) this.paths.push(Array.from({ length: ARC_SEGMENTS + 1 }, () => new THREE.Vector3()));
  }

  hide(): void {
    this.mesh.visible = false;
  }

  update(f: CueFrame): void {
    const C = CONFIG.aids;
    const p = f.ship.position;
    // Candidate surfaces: the next wall (closest point on its solid part) and the tunnel wall.
    const targets: { point: THREE.Vector3; k: number }[] = [];
    const ahead = wallAhead(f.ship, f.obstacles);
    if (ahead) {
      const c = ahead.o.closestPoint(p.x, p.y, p.z, tmpA);
      const d = c.distanceTo(p);
      if (d < C.arcRange) targets.push({ point: c.clone(), k: 1 - d / C.arcRange });
    }
    const radial = Math.hypot(p.x, p.y);
    const toTube = CONFIG.tube.radius - radial;
    if (toTube < C.arcTubeRange && radial > 1e-3) {
      const s = CONFIG.tube.radius / radial;
      targets.push({ point: new THREE.Vector3(p.x * s, p.y * s, p.z - 1.5), k: 1 - toTube / C.arcTubeRange });
    }

    this.regen -= f.dt;
    if (this.regen <= 0) {
      this.regen = 0.045 + Math.random() * 0.03;
      this.boltK.length = 0;
      let b = 0;
      for (const t of targets) {
        // More bolts and fewer gaps in the flicker as the surface gets closer.
        const count = 1 + Math.floor(t.k * 2.5);
        for (let i = 0; i < count && b < MAX_BOLTS; i++) {
          if (Math.random() > 0.35 + t.k * 0.65) continue;
          this.makeBolt(this.paths[b], p, t.point, t.k);
          this.boltK[b] = t.k;
          b++;
          // Sparks where the bolt lands.
          if (Math.random() < t.k) {
            for (let n = 0; n < 3; n++) {
              this.particles.emit(t.point.x, t.point.y, t.point.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, Math.random() * 3, {
                life: 0.25,
                size: 0.12,
                endSize: 0,
                color: this.sparkColor,
                endColor: this.sparkEnd,
                drag: 3,
              });
            }
          }
        }
      }
    }
    if (targets.length === 0) this.boltK.length = 0;
    this.build(f.camera);
  }

  /** Jagged path from a to b by recursive midpoint displacement. */
  private makeBolt(out: THREE.Vector3[], a: THREE.Vector3, b: THREE.Vector3, k: number): void {
    out[0].copy(a);
    out[ARC_SEGMENTS].copy(b);
    const len = a.distanceTo(b);
    const fill = (i0: number, i1: number, amp: number) => {
      if (i1 - i0 < 2) return;
      const m = (i0 + i1) >> 1;
      out[m].copy(out[i0]).lerp(out[i1], 0.5);
      out[m].x += (Math.random() - 0.5) * amp;
      out[m].y += (Math.random() - 0.5) * amp;
      out[m].z += (Math.random() - 0.5) * amp;
      fill(i0, m, amp * 0.55);
      fill(m, i1, amp * 0.55);
    };
    fill(0, ARC_SEGMENTS, len * (0.35 - k * 0.1));
  }

  /** Camera-facing ribbons along each bolt (WebGL lines are always 1 px wide). */
  private build(camera: THREE.Camera): void {
    let v = 0;
    const cam = camera.position;
    for (let b = 0; b < this.boltK.length; b++) {
      const k = this.boltK[b];
      const path = this.paths[b];
      const width = 0.025 + k * 0.05;
      const bright = 0.8 + k * 2.2;
      for (let i = 0; i < ARC_SEGMENTS; i++) {
        const a = path[i];
        const c = path[i + 1];
        const dir = tmpA.subVectors(c, a);
        const side = tmpB.subVectors(cam, a).cross(dir).normalize().multiplyScalar(width);
        // Taper toward the ship so the bolt seems to leap from it.
        const t0 = 0.5 + 0.5 * (i / ARC_SEGMENTS);
        const t1 = 0.5 + 0.5 * ((i + 1) / ARC_SEGMENTS);
        const quad = [
          tmpC.copy(a).addScaledVector(side, -t0).toArray(),
          tmpC.copy(a).addScaledVector(side, t0).toArray(),
          tmpC.copy(c).addScaledVector(side, t1).toArray(),
          tmpC.copy(c).addScaledVector(side, -t1).toArray(),
        ];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
          this.pos.set(quad[idx], v * 3);
          this.col.set([0.45 * bright, 0.75 * bright, 1.6 * bright], v * 3);
          v++;
        }
      }
    }
    this.geo.setDrawRange(0, v);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = v > 0;
  }
}

// --------------------------------------------------------------------------------------------
// Headlight

/**
 * A spotlight from the ship's nose along its heading. With a fixed cone, the pool on the wall ahead is
 * naturally wide and dim far away and small and bright up close. Lined up with a gap, the light falls
 * through the hole and the pool disappears. It also lights the tunnel when heading into its wall.
 */
export class Headlight {
  readonly light: THREE.SpotLight;

  constructor() {
    const C = CONFIG.aids;
    this.light = new THREE.SpotLight(0xe8f6ff, 0, 140, C.headlightAngle, 0.55, 1.6);
    // Always in the scene (intensity 0 when off), so toggling never triggers a shader rebuild.
  }

  hide(): void {
    this.light.intensity = 0;
  }

  update(f: CueFrame): void {
    const s = f.ship;
    this.light.position.copy(s.position).addScaledVector(s.direction, 0.4);
    this.light.target.position.copy(s.position).addScaledVector(s.direction, 60);
    this.light.target.updateMatrixWorld();
    // Fade in as a wall approaches, and keep the pool from flaring to white right before contact.
    const ahead = wallAhead(s, f.obstacles);
    const dist = ahead ? ahead.dist : 200;
    const fadeIn = THREE.MathUtils.smoothstep(CONFIG.aids.fadeStart * 1.4 - dist / s.speed, 0, 1.2);
    const closeCap = Math.min(1, Math.pow(Math.max(dist, 0.5) / 7, 1.6));
    this.light.intensity = CONFIG.aids.headlightIntensity * fadeIn * closeCap;
  }
}

// --------------------------------------------------------------------------------------------
// Heat glow

const heatVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xy;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const heatFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uHot;     // 0 = faint haze, 1 = white-hot core
  uniform float uTime;
  varying vec2 vUv;
  varying vec2 vWorld;
  ${GAP_GLSL}
  void main() {
    if (inGap(vWorld)) discard;
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    float glow = pow(1.0 - r, 2.0);
    // Faint rings rippling outward, like a field being pushed on.
    float ripple = 0.8 + 0.2 * sin(r * 22.0 - uTime * 14.0);
    vec3 col = mix(uColor, vec3(1.6, 1.7, 1.8), uHot * pow(1.0 - r, 6.0));
    gl_FragColor = vec4(col * glow * ripple * uIntensity, 1.0);
  }
`;

/**
 * The wall glows where the ship is lined up with it (straight down the tunnel, like the shadow): a wide,
 * faint haze far away that tightens into a hot, bright spot just before contact. Clipped by the gap.
 */
export class HeatGlow {
  readonly mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;
  private time = 0;

  constructor() {
    this.uniforms = {
      uColor: { value: new THREE.Color(0.25, 1.1, 1.8) },
      uIntensity: { value: 0 },
      uHot: { value: 0 },
      uTime: { value: 0 },
      ...gapUniforms(),
    };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: heatVertex,
        fragmentShader: heatFragment,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  update(f: CueFrame): void {
    const ahead = wallAhead(f.ship, f.obstacles);
    if (!ahead || ahead.dist <= 0) return this.hide();
    const { o, dist } = ahead;
    const t = dist / f.ship.speed;
    const fade = THREE.MathUtils.smoothstep(CONFIG.aids.fadeStart - t, 0, CONFIG.aids.fadeStart - CONFIG.aids.fadeFull);
    if (fade <= 0) return this.hide();
    this.time += f.dt;
    const p = f.ship.position;
    this.mesh.visible = true;
    this.mesh.position.set(p.x, p.y, o.z + FACE + 0.05);
    const half = 0.5 + dist * 0.07;
    this.mesh.scale.setScalar(half);
    const close = 1 - THREE.MathUtils.clamp(dist / 25, 0, 1);
    this.uniforms.uIntensity.value = fade * (0.35 + close * 1.2);
    this.uniforms.uHot.value = close * close;
    this.uniforms.uTime.value = this.time;
    setGapUniforms(this.uniforms, o);
  }
}

// --------------------------------------------------------------------------------------------
// Bow-wave dust

const DUST_MAX = 160;

/**
 * Dust pushed ahead of the ship along its heading, faster than the ship. Where the heading meets solid
 * wall, it splashes against the wall (a spreading puff right where the ship would hit); lined up with the
 * gap, it streams on through. It shows the heading, not just the position, without any marker.
 */
export class BowWave {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private alive: Uint8Array;
  private cursor = 0;
  private spawnAcc = 0;
  private particles: Particles;
  private splash = new THREE.Color(1.1, 1.2, 1.4);
  private splashEnd = new THREE.Color(0.25, 0.3, 0.45);

  constructor(particles: Particles) {
    this.particles = particles;
    this.pos = new Float32Array(DUST_MAX * 3);
    this.vel = new Float32Array(DUST_MAX * 3);
    this.life = new Float32Array(DUST_MAX);
    this.alive = new Uint8Array(DUST_MAX);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.16,
        map: createGlowTexture(),
        color: new THREE.Color(0.9, 1.0, 1.2),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.points.frustumCulled = false;
    this.clear();
  }

  clear(): void {
    this.alive.fill(0);
    for (let i = 0; i < DUST_MAX; i++) this.pos[i * 3 + 2] = 1e6; // parked far away
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  update(f: CueFrame, spawn: boolean): void {
    const s = f.ship;
    const ahead = wallAhead(s, f.obstacles);
    // Spawn only while a wall is coming up, more densely as it gets closer.
    if (spawn && ahead && ahead.dist > 2) {
      const t = ahead.dist / s.speed;
      const rate = 140 * THREE.MathUtils.smoothstep(CONFIG.aids.fadeStart * 1.2 - t, 0, 1);
      this.spawnAcc += rate * f.dt;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        this.spawnOne(s);
      }
    }
    const R = CONFIG.tube.radius;
    for (let i = 0; i < DUST_MAX; i++) {
      if (!this.alive[i]) continue;
      const i3 = i * 3;
      const pz = this.pos[i3 + 2];
      this.pos[i3] += this.vel[i3] * f.dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * f.dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * f.dt;
      this.life[i] -= f.dt;
      const x = this.pos[i3];
      const y = this.pos[i3 + 1];
      const z = this.pos[i3 + 2];
      // Crossing the next wall's face: splash on solid wall, stream through the gap.
      if (ahead) {
        const face = ahead.o.z + FACE;
        if (pz > face && z <= face && !ahead.o.fits(x, y, 0)) {
          this.splashAt(x, y, face + 0.05);
          this.kill(i);
          continue;
        }
      }
      if (Math.hypot(x, y) > R - 0.05) {
        this.kill(i);
        continue;
      }
      if (this.life[i] <= 0) this.kill(i);
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private spawnOne(s: Ship): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % DUST_MAX;
    const d = s.direction;
    // A small disc just in front of the nose, perpendicular-ish to the heading.
    const jx = (Math.random() - 0.5) * 0.8;
    const jy = (Math.random() - 0.5) * 0.5;
    this.pos.set([s.position.x + d.x * 1.2 + jx, s.position.y + d.y * 1.2 + jy, s.position.z + d.z * 1.2], i * 3);
    const v = s.speed * 1.9;
    this.vel.set([d.x * v + jx * 0.6, d.y * v + jy * 0.6, d.z * v], i * 3);
    this.life[i] = 2.5;
    this.alive[i] = 1;
  }

  private splashAt(x: number, y: number, z: number): void {
    for (let n = 0; n < 3; n++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      this.particles.emit(x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + Math.random(), {
        life: 0.5,
        size: 0.14,
        endSize: 0.32,
        color: this.splash,
        endColor: this.splashEnd,
        drag: 2.5,
      });
    }
  }

  private kill(i: number): void {
    this.alive[i] = 0;
    this.pos[i * 3 + 2] = 1e6;
  }
}

// --------------------------------------------------------------------------------------------

/** Owns the optional in-world cues and drives the ones switched on. */
export class WorldCues {
  readonly arcs: ElectricArcs;
  readonly headlight = new Headlight();
  readonly heat = new HeatGlow();
  readonly dust: BowWave;

  constructor(scene: THREE.Scene, particles: Particles) {
    this.arcs = new ElectricArcs(particles);
    this.dust = new BowWave(particles);
    scene.add(this.arcs.mesh, this.headlight.light, this.headlight.light.target, this.heat.mesh, this.dust.points);
  }

  update(f: CueFrame): void {
    if (f.aids.arcs) this.arcs.update(f);
    else this.arcs.hide();
    if (f.aids.headlight) this.headlight.update(f);
    else this.headlight.hide();
    if (f.aids.heat) this.heat.update(f);
    else this.heat.hide();
    // Dust already in flight finishes its trip even if the toggle goes off.
    this.dust.update(f, f.aids.dust);
  }

  clear(): void {
    this.arcs.hide();
    this.headlight.hide();
    this.heat.hide();
    this.dust.clear();
  }
}
