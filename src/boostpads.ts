import * as THREE from 'three';
import { CONFIG } from './config';
import type { Obstacle } from './obstacles';

const padVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

// Violet panel with white chevrons streaming forward (toward −z, which is v decreasing).
const padFragment = /* glsl */ `
  uniform float uTime;
  uniform float uFlash;   // 1 right after triggering, decays to 0
  uniform float uSpent;   // 1 once used: dim, slow
  uniform vec3 uColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    float u = vUv.x - 0.5;            // across the pad
    float along = 1.0 - vUv.y;        // 0 at the back end, 1 at the front end
    float speed = mix(2.2, 0.4, uSpent);
    // Chevrons: bands bent into a V that points forward.
    float k = fract(along * 6.0 - abs(u) * 2.2 - uTime * speed);
    float chevron = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.32, 0.42, k));
    // Bright frame around the edge.
    float edgeU = 1.0 - smoothstep(0.40, 0.48, abs(u));
    float edgeV = smoothstep(0.0, 0.04, along) * (1.0 - smoothstep(0.96, 1.0, along));
    float frame = 1.0 - edgeU * edgeV;
    // Kept below the bloom threshold except at the chevron cores, so it reads as violet, not white.
    vec3 base = uColor * 0.22;
    vec3 col = base + uColor * (chevron * 0.75 + frame * 0.5) * mix(1.0, 0.3, uSpent);
    col = mix(col, uColor * 1.6 + 0.3, uFlash * (0.3 + chevron * 0.7));
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  }
`;

interface Pad {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  /** Centre angle around the tunnel (radians, same convention as atan2(y, x)). */
  angle: number;
  zStart: number; // back end (larger z)
  zEnd: number; // front end (smaller z)
  active: boolean;
  spent: boolean;
  flash: number;
}

/**
 * Boost pads: violet panels with streaming chevrons on the tunnel wall. Flying close over one triggers
 * the boost automatically, or extends it if already boosting. Each pad fires once.
 * They are placed in the stretch before a wall, on the side of the tunnel nearest that wall's gap, so a
 * line over the pad can carry you on toward the opening.
 */
export class BoostPads {
  readonly group = new THREE.Group();
  /** Violet glow cast from the nearest live pad onto the ship and the tunnel around it. */
  readonly light: THREE.PointLight;
  private pads: Pad[] = [];
  private time = 0;
  private color = new THREE.Color(0.55, 0.16, 1.0);

  constructor(fogColor: THREE.Color, fogDensity: number) {
    const P = CONFIG.pads;
    const R = CONFIG.tube.radius - 0.04;
    const geo = new THREE.CylinderGeometry(R, R, P.length, 12, 1, true, -P.arc / 2, P.arc);
    geo.rotateX(Math.PI / 2); // axis along z; v = 1 at the back end (+z)
    for (let i = 0; i < P.pool; i++) {
      const uniforms = {
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uSpent: { value: 0 },
        uColor: { value: this.color },
        uFogColor: { value: fogColor },
        uFogDensity: { value: fogDensity },
      };
      const mesh = new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({ uniforms, vertexShader: padVertex, fragmentShader: padFragment, side: THREE.DoubleSide }),
      );
      mesh.visible = false;
      this.group.add(mesh);
      this.pads.push({ mesh, uniforms, angle: 0, zStart: 0, zEnd: 0, active: false, spent: false, flash: 0 });
    }
    this.light = new THREE.PointLight(0xa060ff, 0, 30, 1.6);
    this.group.add(this.light);
  }

  clear(): void {
    for (const p of this.pads) {
      p.active = false;
      p.mesh.visible = false;
    }
    this.light.intensity = 0;
  }

  /**
   * Maybe place a pad in the stretch [stretchStartZ → o.z] leading up to a newly spawned wall.
   * Pads start from the `firstAt`-th wall, so the first walls teach plain flying.
   */
  onWallSpawned(o: Obstacle, index: number, stretchStartZ: number, gap: THREE.Vector2): void {
    const P = CONFIG.pads;
    if (index < P.firstWall || Math.random() > P.chance) return;
    const pad = this.pads.find((p) => !p.active);
    if (!pad) return;
    // On the side of the tunnel facing the gap, so the pad and the opening line up; random if the gap is central.
    const off = Math.hypot(gap.x, gap.y);
    const toward = off > 2 ? Math.atan2(gap.y, gap.x) : Math.random() * Math.PI * 2;
    pad.angle = toward + (Math.random() - 0.5) * P.angleJitter;
    // In the middle of the stretch, leaving room before the wall to react at boost speed.
    const mid = (stretchStartZ + o.z) / 2 + P.length * 0.2;
    pad.zStart = mid + P.length / 2;
    pad.zEnd = mid - P.length / 2;
    pad.active = true;
    pad.spent = false;
    pad.flash = 0;
    pad.uniforms.uSpent.value = 0;
    pad.uniforms.uFlash.value = 0;
    pad.mesh.position.z = mid;
    // Cylinder angle 0 sits at world angle −π/2 after the rotation above.
    pad.mesh.rotation.z = pad.angle + Math.PI / 2;
    pad.mesh.visible = true;
  }

  /**
   * Animate pads, recycle passed ones, and return true if the ship has just triggered one.
   * `canTrigger` is false outside a run (attract mode still shows the pads).
   */
  update(dt: number, shipPos: THREE.Vector3, canTrigger: boolean): boolean {
    const P = CONFIG.pads;
    const R = CONFIG.tube.radius;
    this.time += dt;
    let triggered = false;
    let nearest: Pad | null = null;
    let nearestDz = Infinity;
    const radial = Math.hypot(shipPos.x, shipPos.y);
    const shipAngle = Math.atan2(shipPos.y, shipPos.x);
    for (const p of this.pads) {
      if (!p.active) continue;
      if (p.zEnd > shipPos.z + 30) {
        // Well behind the camera: free it for reuse.
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.uniforms.uTime.value = this.time;
      if (p.flash > 0) {
        p.flash = Math.max(0, p.flash - dt * 2.5);
        p.uniforms.uFlash.value = p.flash;
      }
      if (!p.spent) {
        // Distance from the ship to the pad's middle along the tunnel (positive while it's ahead).
        const dz = shipPos.z - (p.zStart + p.zEnd) / 2;
        if (dz > -P.length && Math.abs(dz) < Math.abs(nearestDz)) {
          nearest = p;
          nearestDz = dz;
        }
        // Over the pad: within its length, its arc (plus a margin), and close enough to the wall.
        const within = shipPos.z <= p.zStart && shipPos.z >= p.zEnd;
        const dAngle = Math.abs(Math.atan2(Math.sin(shipAngle - p.angle), Math.cos(shipAngle - p.angle)));
        const onArc = radial > 0.5 && dAngle * R < (P.arc / 2) * R + P.sideMargin;
        if (canTrigger && within && onArc && R - radial < P.triggerDistance) {
          p.spent = true;
          p.flash = 1;
          p.uniforms.uSpent.value = 1;
          triggered = true;
        }
      }
    }
    // Light from the nearest live pad, brightest as the ship passes over it.
    if (nearest) {
      const mid = (nearest.zStart + nearest.zEnd) / 2;
      this.light.position.set(Math.cos(nearest.angle) * (R - 1.5), Math.sin(nearest.angle) * (R - 1.5), mid);
      this.light.intensity = 35 * THREE.MathUtils.clamp(1 - Math.abs(nearestDz) / 60, 0, 1);
    } else {
      this.light.intensity = Math.max(0, this.light.intensity - dt * 400);
    }
    return triggered;
  }
}
