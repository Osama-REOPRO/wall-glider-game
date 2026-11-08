import * as THREE from 'three';
import { CONFIG } from './config';
import { BEVEL } from './collision';
import type { Obstacle, Obstacles } from './obstacles';

/** Which flight aids are switched on (each is toggled separately in the Aids panel). */
export interface AidSettings {
  shadow: boolean;
  rim: boolean;
  forgiving: boolean;
}

export const DEFAULT_AIDS: AidSettings = { shadow: true, rim: true, forgiving: true };

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

/**
 * The projected "shadow": the ship's rear silhouette drawn where it will cross the next wall,
 * cast along the flight path rather than by a light, so it is right at any heading.
 * On course to hit: a dark shadow with a red outline on the wall's face.
 * On course to pass: a cyan outline floating in the gap.
 * A ring marks the actual collision footprint (the hitbox) at the centre.
 * Corner brackets keep the spot readable from far away; they close in on the silhouette as the wall nears.
 */
export class ProjectedShadow {
  readonly group = new THREE.Group();
  private fillMat: THREE.MeshBasicMaterial;
  private lineMat: THREE.LineBasicMaterial;
  private coreMat: THREE.LineBasicMaterial;
  private core: THREE.LineLoop;
  private brackets: THREE.Mesh;
  private bracketMat: THREE.MeshBasicMaterial;
  /** Soft dark blob under the brackets on a hit course: the classic platformer drop shadow. */
  private blob: THREE.Mesh;
  private blobMat: THREE.MeshBasicMaterial;
  // Moderate HDR values: brighter ones get desaturated toward white by the tone mapper.
  private hitColor = new THREE.Color(1.8, 0.06, 0.04);
  private passColor = new THREE.Color(0.25, 1.5, 2.0);

  constructor() {
    const shape = rearProfile();
    this.fillMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, fog: false });
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.fillMat);
    this.lineMat = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, fog: false });
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(shape.getPoints()), this.lineMat);
    this.coreMat = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, fog: false });
    const circle: THREE.Vector3[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      circle.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    }
    this.core = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circle), this.coreMat);
    this.bracketMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.brackets = new THREE.Mesh(bracketGeometry(), this.bracketMat);
    this.blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, depthWrite: false, fog: false });
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blobMat);
    // Draw after the (transparent) walls so the shadow sits on top of their face; blob first.
    this.blob.renderOrder = 2;
    for (const o of [fill, outline, this.core, this.brackets]) o.renderOrder = 3;
    this.group.add(this.blob, fill, outline, this.core, this.brackets);
    this.group.visible = false;
  }

  hide(): void {
    this.group.visible = false;
  }

  show(p: Prediction, bank: number, radius: number): void {
    if (p.outcome === 'tube' || p.strength <= 0) {
      this.hide();
      return;
    }
    const hit = p.outcome === 'wall';
    this.group.visible = true;
    // Just in front of the wall's face so it never z-fights with it.
    this.group.position.set(p.point.x, p.point.y, p.point.z + 0.05);
    this.group.rotation.z = bank;
    this.core.scale.setScalar(radius);
    this.fillMat.opacity = hit ? 0.75 * p.strength : 0.0;
    this.lineMat.color.copy(hit ? this.hitColor : this.passColor);
    this.lineMat.opacity = p.strength;
    this.coreMat.color.copy(this.lineMat.color);
    this.coreMat.opacity = p.strength * 0.9;
    // Brackets: about 5% of the distance to the wall across, never tighter than the wingspan.
    const dist = p.timeToImpact * this.speedHint;
    const half = Math.max(0.62 * CONFIG.ship.scale * 1.4, dist * 0.05);
    this.brackets.scale.setScalar(half);
    this.blob.scale.setScalar(half * 1.35);
    this.blobMat.opacity = hit ? 0.8 * p.strength : 0;
    this.brackets.rotation.z = -bank; // keep brackets square to the screen, not banked
    this.bracketMat.color.copy(this.lineMat.color);
    this.bracketMat.opacity = p.strength;
  }

  /** Current ship speed, used to turn time-to-impact back into distance for the bracket size. */
  speedHint: number = CONFIG.ship.startSpeed;
}
