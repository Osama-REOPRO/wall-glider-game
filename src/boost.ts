import * as THREE from 'three';
import { CONFIG } from './config';

const LINES = 70;

const tmpSide = new THREE.Vector3();
const tmpToCam = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const perpU = new THREE.Vector3();
const perpV = new THREE.Vector3();

/**
 * Speed lines while boosting: long, thin streaks of light hanging in the air along the ship's heading.
 * They are fixed in the world and the ship rushes past them, so they sell the jump in speed.
 * Built as camera-facing ribbons (WebGL lines are always 1 px wide), one draw call.
 */
export class SpeedLines {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;
  private start: THREE.Vector3[] = [];
  private len: number[] = [];
  private live: boolean[] = [];

  constructor() {
    this.pos = new Float32Array(LINES * 6 * 3);
    this.col = new Float32Array(LINES * 6 * 3);
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
    for (let i = 0; i < LINES; i++) {
      this.start.push(new THREE.Vector3());
      this.len.push(0);
      this.live.push(false);
    }
  }

  clear(): void {
    this.live.fill(false);
    this.mesh.visible = false;
  }

  /** `level` is the 0..1 boost level; `tunnel` keeps lines inside the tube. */
  update(level: number, shipPos: THREE.Vector3, dir: THREE.Vector3, camera: THREE.Camera, tunnel: boolean): void {
    if (level <= 0.01) {
      this.clear();
      return;
    }
    // Basis perpendicular to the heading, for scattering lines around the flight path.
    perpU.set(0, 1, 0).cross(dir);
    if (perpU.lengthSq() < 1e-4) perpU.set(1, 0, 0);
    perpU.normalize();
    perpV.crossVectors(dir, perpU).normalize();

    let v = 0;
    const cam = camera.position;
    for (let i = 0; i < LINES; i++) {
      // Recycle lines the ship has passed (or that were never placed) to somewhere ahead.
      const along = tmpA.subVectors(this.start[i], shipPos).dot(dir);
      if (!this.live[i] || along + this.len[i] < -10) this.respawn(i, shipPos, dir, tunnel);
      const s = this.start[i];
      const e = tmpB.copy(s).addScaledVector(dir, this.len[i]);
      tmpToCam.subVectors(cam, s);
      tmpSide.crossVectors(dir, tmpToCam).normalize().multiplyScalar(0.022);
      // Fade lines in as they come out of the distance so they don't pop.
      const ahead = tmpA.subVectors(s, shipPos).dot(dir);
      const fade = THREE.MathUtils.clamp(1 - (ahead - 60) / 40, 0, 1) * level;
      const c = 0.9 * fade;
      const quad = [
        [s.x - tmpSide.x, s.y - tmpSide.y, s.z - tmpSide.z],
        [s.x + tmpSide.x, s.y + tmpSide.y, s.z + tmpSide.z],
        [e.x + tmpSide.x, e.y + tmpSide.y, e.z + tmpSide.z],
        [e.x - tmpSide.x, e.y - tmpSide.y, e.z - tmpSide.z],
      ];
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        this.pos.set(quad[idx], v * 3);
        this.col.set([0.6 * c, 0.85 * c, 1.2 * c], v * 3);
        v++;
      }
    }
    this.geo.setDrawRange(0, v);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = true;
  }

  private respawn(i: number, shipPos: THREE.Vector3, dir: THREE.Vector3, tunnel: boolean): void {
    const fresh = !this.live[i];
    // A ring around the flight path, clear of the ship itself.
    const a = Math.random() * Math.PI * 2;
    // Keep clear of the camera's line of sight: lines right beside the lens become huge slashes.
    const r = 3.5 + Math.random() * 9;
    const ahead = fresh ? Math.random() * 100 - 5 : 70 + Math.random() * 30;
    const p = this.start[i]
      .copy(shipPos)
      .addScaledVector(dir, ahead)
      .addScaledVector(perpU, Math.cos(a) * r)
      .addScaledVector(perpV, Math.sin(a) * r);
    if (tunnel) {
      const maxR = CONFIG.tube.radius - 0.8;
      const rad = Math.hypot(p.x, p.y);
      if (rad > maxR) {
        p.x *= maxR / rad;
        p.y *= maxR / rad;
      }
    }
    this.len[i] = 5 + Math.random() * 10;
    this.live[i] = true;
  }
}
