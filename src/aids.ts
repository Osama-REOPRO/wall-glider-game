import * as THREE from 'three';
import { CONFIG } from './config';
import { BEVEL } from './collision';
import type { Obstacle, Obstacles } from './obstacles';

/** Which flight aids are switched on (each is toggled separately in the Aids panel). */
export interface AidSettings {
  /** In world: the ship's shadow on the next wall. */
  shadow: boolean;
  /** In world: the gap rim pulses red on a hit course. */
  rim: boolean;
  /** In world: electric arcs jump between the ship and the nearest surface. */
  arcs: boolean;
  /** In world: a forward spotlight whose pool tightens on the wall ahead. */
  headlight: boolean;
  /** In world: the wall glows where the ship is lined up with it. */
  heat: boolean;
  /** In world: dust pushed ahead of the ship splashes where it will hit. */
  dust: boolean;
  /** Interface: brackets, outline and hitbox ring at the crossing point. */
  markers: boolean;
  /** Rules: smaller collision radius. */
  forgiving: boolean;
}

// Interface markers are off by default: cues should live in the world (see docs/DESIGN.md, "Guiding principles").
// The newer in-world cues start off so they can be tried one at a time.
export const DEFAULT_AIDS: AidSettings = {
  shadow: true,
  rim: true,
  arcs: false,
  headlight: false,
  heat: false,
  dust: false,
  markers: false,
  forgiving: true,
};

export interface Prediction {
  obstacle: Obstacle;
  /** Where the ship will cross the wall's front face if it holds its heading. */
  point: THREE.Vector3;
  /** 'pass' through the gap, 'wall' = hit the obstacle, 'tube' = hit the tunnel wall before reaching it. */
  outcome: 'pass' | 'wall' | 'tube';
  /** Seconds until the ship reaches the wall's face. */
  timeToImpact: number;
  /** 0..1 cue strength from the time-to-impact fade. */
  strength: number;
}

/** Collision radius in use, given the forgiving-hitbox setting. */
export function hitRadius(aids: AidSettings): number {
  return CONFIG.ship.radius * (aids.forgiving ? CONFIG.aids.forgivingScale : 1);
}

const dir = new THREE.Vector3();
const point = new THREE.Vector3();

/**
 * Predict where the ship crosses the next wall if it holds the given heading.
 * It uses the same gap test (and margin) as the collision check, so the cues can't disagree with it.
 * For a spinning slot it tests the rotation the slot will have when the ship arrives.
 */
export function predict(
  shipPos: THREE.Vector3,
  yaw: number,
  pitch: number,
  speed: number,
  obstacles: Obstacles,
  radius: number,
): Prediction | null {
  const o = obstacles.nextAhead(shipPos.z);
  if (!o) return null;
  const cp = Math.cos(pitch);
  dir.set(Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  if (dir.z > -0.01) return null;

  const faceZ = o.z + CONFIG.obstacles.thickness / 2 + BEVEL;
  const dist = (faceZ - shipPos.z) / dir.z; // distance along the heading
  if (dist < 0) return null; // already inside the wall's slab: the collision check has it
  point.copy(shipPos).addScaledVector(dir, dist);
  const timeToImpact = dist / Math.max(1, speed);

  let outcome: Prediction['outcome'];
  if (Math.hypot(point.x, point.y) + radius >= CONFIG.tube.radius) outcome = 'tube';
  else {
    const arrivalAngle = o.angle + o.spin * timeToImpact;
    outcome = o.fits(point.x, point.y, radius + BEVEL, arrivalAngle) ? 'pass' : 'wall';
  }

  const { fadeStart, fadeFull } = CONFIG.aids;
  const strength = THREE.MathUtils.smoothstep(fadeStart - timeToImpact, 0, fadeStart - fadeFull);
  return { obstacle: o, point, outcome, timeToImpact, strength };
}

/** The ship's silhouette seen from behind (flat wings, small dorsal fin), in model units. */
const REAR_PROFILE: [number, number][] = [
  [-0.8, -0.05], [0.8, -0.05], [0.8, 0.04], [0.2, 0.09], [0, 0.32], [-0.2, 0.09], [-0.8, 0.04],
];

/** The rear silhouette as a shape, in world units at ship scale. */
function rearProfile(): THREE.Shape {
  const k = CONFIG.ship.scale;
  const s = new THREE.Shape();
  s.moveTo(REAR_PROFILE[0][0] * k, REAR_PROFILE[0][1] * k);
  for (const [x, y] of REAR_PROFILE.slice(1)) s.lineTo(x * k, y * k);
  s.closePath();
  return s;
}

/**
 * Four corner brackets around a unit square, built from thin quads (WebGL lines are always 1px).
 * Scaled at runtime so they stay readable on screen at any distance.
 */
function bracketGeometry(): THREE.BufferGeometry {
  const L = 0.42; // arm length
  const T = 0.12; // bar thickness
  const quads: [number, number, number, number][] = []; // x0, y0, x1, y1
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      // Horizontal arm and vertical arm meeting at the corner (sx, sy).
      quads.push([sx, sy, sx - sx * L, sy - sy * T]);
      quads.push([sx, sy, sx - sx * T, sy - sy * L]);
    }
  }
  const pos: number[] = [];
  for (const [x0, y0, x1, y1] of quads) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    pos.push(ax, ay, 0, bx, ay, 0, bx, by, 0, ax, ay, 0, bx, by, 0, ax, by, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

const PROFILE_N = REAR_PROFILE.length;

/**
 * GLSL for "is this world x/y inside the wall's gap?", mirroring Obstacle.fits() with no margin.
 * Every in-world cue drawn on a wall's face uses it so it can be clipped like a real surface effect.
 */
export const GAP_GLSL = /* glsl */ `
  uniform float uKind;   // 0 = circular hole, 1 = slot
  uniform vec3 uHole;    // circle: centre x, y and radius; slot: (unused, offset, half-height)
  uniform float uAngle;  // the wall's current rotation
  bool inGap(vec2 w) {
    float c = cos(-uAngle), sn = sin(-uAngle);
    vec2 g = vec2(w.x * c - w.y * sn, w.x * sn + w.y * c);
    return uKind < 0.5 ? length(g - uHole.xy) < uHole.z : abs(g.y - uHole.y) < uHole.z;
  }
`;

export function gapUniforms(): Record<string, THREE.IUniform> {
  return { uKind: { value: 0 }, uHole: { value: new THREE.Vector3() }, uAngle: { value: 0 } };
}

/** Point the gap uniforms at a wall (the bevel makes the visible hole slightly smaller). */
export function setGapUniforms(u: Record<string, THREE.IUniform>, o: Obstacle): void {
  u.uKind.value = o.kind === 'circle' ? 0 : 1;
  (u.uHole.value as THREE.Vector3).set(o.cx, o.cy, o.r - BEVEL);
  u.uAngle.value = o.angle;
}

const shadowVertex = /* glsl */ `
  uniform float uHalf;
  varying vec2 vLocal;
  varying vec2 vWorld;
  void main() {
    vLocal = position.xy * uHalf; // ship-frame coordinates (the mesh is rotated with the bank)
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xy;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// A soft shadow of the ship's silhouette. The edge softness comes from the signed distance to the
// silhouette polygon, so one parameter (uSoft) takes it from a wide blur to a crisp outline.
// Fragments inside the wall's gap are discarded: the gap test mirrors Obstacle.fits().
const shadowFragment = /* glsl */ `
  #define N ${PROFILE_N}
  uniform vec2 uPoly[N];
  uniform float uSoft;     // penumbra half-width in world units
  uniform float uDark;     // darkness at the umbra
  varying vec2 vLocal;
  varying vec2 vWorld;

  // Signed distance to a polygon (negative inside), after Inigo Quilez.
  float sdPolygon(vec2 p) {
    float d = dot(p - uPoly[0], p - uPoly[0]);
    float s = 1.0;
    vec2 prev = uPoly[N - 1];
    for (int i = 0; i < N; i++) {
      vec2 cur = uPoly[i];
      vec2 e = prev - cur;
      vec2 w = p - cur;
      vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
      d = min(d, dot(b, b));
      bvec3 c = bvec3(p.y >= cur.y, p.y < prev.y, e.x * w.y > e.y * w.x);
      if (all(c) || all(not(c))) s = -s;
      prev = cur;
    }
    return s * sqrt(d);
  }

  ${GAP_GLSL}

  void main() {
    if (inGap(vWorld)) discard;
    float d = sdPolygon(vLocal);
    // The blur spreads outward from the silhouette, so the core stays dark even when the edge is wide
    // (the ship is thin from behind: a blur centred on the edge would wash the whole shadow out).
    float a = 1.0 - smoothstep(0.0, uSoft * 2.0, d);
    gl_FragColor = vec4(0.0, 0.0, 0.0, a * uDark);
  }
`;

/**
 * In-world aid: the ship's shadow on the next wall, cast perpendicular to the wall (as if lit from
 * straight down the tunnel behind the ship), so it sits exactly where the ship is right now. It is plain
 * dark, with no UI colour, and it is clipped by the gap like a real shadow: on the wall while the ship is
 * lined up with the wall, gone while it is lined up with the gap, and cut by the gap's edge when it
 * overlaps the rim. As the ship closes in, its position and its shadow converge on the impact point.
 *
 * Like a real penumbra, its softness depends on how far the ship is from the wall: far away it is a
 * wide, faint blur; it tightens into a crisp, dark silhouette at the moment of contact.
 */
export class WallShadow {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor() {
    const k = CONFIG.ship.scale;
    this.uniforms = {
      uPoly: { value: REAR_PROFILE.map(([x, y]) => new THREE.Vector2(x * k, y * k)) },
      uHalf: { value: 1 },
      uSoft: { value: 0.02 },
      uDark: { value: 0 },
      ...gapUniforms(),
    };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: shadowVertex,
        fragmentShader: shadowFragment,
        transparent: true,
        depthWrite: false,
      }),
    );
    // Draw after the (transparent) walls so the shadow lies on their face.
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);
    this.group.visible = false;
  }

  hide(): void {
    this.group.visible = false;
  }

  show(p: Prediction, shipPos: THREE.Vector3, bank: number, speed: number): void {
    // Distance straight down the tunnel to the wall's face, and the fade-in from it.
    const faceZ = p.point.z;
    const dist = shipPos.z - faceZ;
    const { fadeStart, fadeFull, shadowSoftness, shadowMinSoft } = CONFIG.aids;
    const tta = dist / Math.max(1, speed);
    const strength = THREE.MathUtils.smoothstep(fadeStart - tta, 0, fadeStart - fadeFull);
    if (dist <= 0 || strength <= 0) {
      this.hide();
      return;
    }
    const o = p.obstacle;
    this.group.visible = true;
    // Perpendicular projection: the ship's own x/y, on the wall's face, turned with the ship's bank.
    this.group.position.set(shipPos.x, shipPos.y, faceZ + 0.05);
    this.mesh.rotation.z = bank;
    // Clip against the gap as it looks now.
    setGapUniforms(this.uniforms, o);
    // Penumbra: the edge blur grows with the ship's distance from the wall, like a real soft shadow.
    // A blurrier shadow spreads the same darkness over more area, so its core is lighter.
    const soft = shadowMinSoft + dist * shadowSoftness;
    this.uniforms.uSoft.value = soft;
    const halfWing = 0.8 * CONFIG.ship.scale;
    this.uniforms.uDark.value = strength * THREE.MathUtils.clamp(halfWing / (halfWing + soft * 0.5), 0.65, 1);
    // The quad must cover the silhouette plus the blur on every side.
    const half = halfWing + soft * 2.1;
    this.uniforms.uHalf.value = half;
    this.mesh.scale.setScalar(half);
  }
}

/**
 * Interface aid: markers showing where the ship will cross the next wall. Red on a hit course,
 * cyan floating in the gap on a pass. They are not clipped by the gap.
 * - The ship's true-size rear outline (banked like the ship) and a ring for the actual hitbox.
 * - Corner brackets that stay about 5% of the distance across, so the spot is readable from far away;
 *   they close in on the outline as the wall nears.
 */
export class TargetMarker {
  readonly group = new THREE.Group();
  private lineMat: THREE.LineBasicMaterial;
  private coreMat: THREE.LineBasicMaterial;
  private core: THREE.LineLoop;
  private outline: THREE.LineLoop;
  private brackets: THREE.Mesh;
  private bracketMat: THREE.MeshBasicMaterial;
  // Moderate HDR values: brighter ones get desaturated toward white by the tone mapper.
  private hitColor = new THREE.Color(1.8, 0.06, 0.04);
  private passColor = new THREE.Color(0.25, 1.5, 2.0);

  constructor() {
    const shape = rearProfile();
    this.lineMat = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, fog: false });
    this.outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(shape.getPoints()), this.lineMat);
    this.coreMat = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, fog: false });
    const circle: THREE.Vector3[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      circle.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    }
    this.core = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circle), this.coreMat);
    this.bracketMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.brackets = new THREE.Mesh(bracketGeometry(), this.bracketMat);
    // Drawn after the walls and the in-world shadow.
    for (const o of [this.outline, this.core, this.brackets]) o.renderOrder = 3;
    this.group.add(this.outline, this.core, this.brackets);
    this.group.visible = false;
  }

  hide(): void {
    this.group.visible = false;
  }

  show(p: Prediction, bank: number, radius: number, speed: number): void {
    if (p.outcome === 'tube' || p.strength <= 0) {
      this.hide();
      return;
    }
    const color = p.outcome === 'wall' ? this.hitColor : this.passColor;
    this.group.visible = true;
    this.group.position.set(p.point.x, p.point.y, p.point.z + 0.06);
    this.outline.rotation.z = bank;
    this.core.scale.setScalar(radius);
    this.lineMat.color.copy(color);
    this.lineMat.opacity = p.strength;
    this.coreMat.color.copy(color);
    this.coreMat.opacity = p.strength * 0.9;
    const dist = p.timeToImpact * speed;
    this.brackets.scale.setScalar(Math.max(0.62 * CONFIG.ship.scale * 1.4, dist * 0.05));
    this.bracketMat.color.copy(color);
    this.bracketMat.opacity = p.strength;
  }
}
