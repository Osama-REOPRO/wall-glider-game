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
  /** Interface: brackets, outline and hitbox ring at the crossing point. */
  markers: boolean;
  /** Rules: smaller collision radius. */
  forgiving: boolean;
}

// Interface markers are off by default: cues should live in the world (see docs/DESIGN.md, "Guiding principles").
export const DEFAULT_AIDS: AidSettings = { shadow: true, rim: true, markers: false, forgiving: true };

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

/** The ship's silhouette seen from behind: flat wings, a small dorsal fin. World units at ship scale. */
function rearProfile(): THREE.Shape {
  const k = CONFIG.ship.scale;
  const s = new THREE.Shape();
  const pts: [number, number][] = [
    [-0.8, -0.05], [0.8, -0.05], [0.8, 0.04], [0.2, 0.09], [0, 0.32], [-0.2, 0.09], [-0.8, 0.04],
  ];
  s.moveTo(pts[0][0] * k, pts[0][1] * k);
  for (const [x, y] of pts.slice(1)) s.lineTo(x * k, y * k);
  s.closePath();
  return s;
}

/** Shadow blob: solid core with a soft edge (alpha only; the material colour is black). */
function blobTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
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

const shadowVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xy;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Darkens the wall except inside the gap: the gap test mirrors Obstacle.fits().
const shadowFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uUseMap;
  uniform float uOpacity;
  uniform float uKind;   // 0 = circular hole, 1 = slot
  uniform vec3 uHole;    // circle: centre x, y and radius; slot: (unused, offset, half-height)
  uniform float uAngle;  // the wall's current rotation
  varying vec2 vUv;
  varying vec2 vWorld;
  void main() {
    float c = cos(-uAngle), s = sin(-uAngle);
    vec2 p = vec2(vWorld.x * c - vWorld.y * s, vWorld.x * s + vWorld.y * c);
    bool inGap = uKind < 0.5 ? length(p - uHole.xy) < uHole.z : abs(p.y - uHole.y) < uHole.z;
    if (inGap) discard;
    float a = uUseMap > 0.5 ? texture2D(uMap, vUv).a : 1.0;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a * uOpacity);
  }
`;

/**
 * In-world aid: the ship's shadow on the next wall, cast along the flight path (not by a light), so it
 * is right at any heading. It is plain dark, with no UI colour, and it is clipped by the gap like a
 * real shadow: fully on the wall on a hit course, gone on a clean pass, and partly cut off when the
 * ship is about to clip the rim.
 * A soft blob around the true-size silhouette acts as a penumbra: it grows softer and lighter with
 * distance, as a real soft shadow does, which keeps the spot findable from far away.
 */
export class WallShadow {
  readonly group = new THREE.Group();
  private blob: THREE.Mesh;
  private blobUniforms: Record<string, THREE.IUniform>;
  private fillUniforms: Record<string, THREE.IUniform>;
  private hole = {
    uKind: { value: 0 },
    uHole: { value: new THREE.Vector3() },
    uAngle: { value: 0 },
  };

  constructor() {
    const make = (map: THREE.Texture | null) => {
      const uniforms: Record<string, THREE.IUniform> = {
        ...this.hole, // shared: one update clips both meshes
        uMap: { value: map },
        uUseMap: { value: map ? 1 : 0 },
        uOpacity: { value: 0 },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: shadowVertex,
        fragmentShader: shadowFragment,
        transparent: true,
        depthWrite: false,
      });
      return { mat, uniforms };
    };
    const blob = make(blobTexture());
    this.blobUniforms = blob.uniforms;
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blob.mat);
    const fill = make(null);
    this.fillUniforms = fill.uniforms;
    const silhouette = new THREE.Mesh(new THREE.ShapeGeometry(rearProfile()), fill.mat);
    this.silhouette = silhouette;
    // Draw after the (transparent) walls so the shadow lies on their face.
    this.blob.renderOrder = 2;
    silhouette.renderOrder = 2;
    this.group.add(this.blob, silhouette);
    this.group.visible = false;
  }

  private silhouette: THREE.Mesh;

  hide(): void {
    this.group.visible = false;
  }

  show(p: Prediction, bank: number, speed: number): void {
    if (p.outcome === 'tube' || p.strength <= 0) {
      this.hide();
      return;
    }
    const o = p.obstacle;
    this.group.visible = true;
    this.group.position.set(p.point.x, p.point.y, p.point.z + 0.05);
    this.silhouette.rotation.z = bank;
    // Clip against the gap as it looks now (the bevel makes the visible hole slightly smaller).
    this.hole.uKind.value = o.kind === 'circle' ? 0 : 1;
    this.hole.uHole.value.set(o.cx, o.cy, o.r - BEVEL);
    this.hole.uAngle.value = o.angle;
    // Penumbra: about the wingspan up close, wider (and a little fainter) with distance. It has to stay
    // dark enough to read against the high-contrast hazard stripes.
    const dist = p.timeToImpact * speed;
    const half = 0.62 * CONFIG.ship.scale + dist * 0.05;
    this.blob.scale.setScalar(half);
    this.blobUniforms.uOpacity.value = p.strength;
    this.fillUniforms.uOpacity.value = p.strength;
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
