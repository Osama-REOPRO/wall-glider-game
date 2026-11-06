import * as THREE from 'three';
import { CONFIG } from './config';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    // Hot core with a soft falloff.
    float a = pow(1.0 - r, 1.8);
    gl_FragColor = vec4(vColor * (a + pow(1.0 - r, 8.0) * 1.5), a * vAlpha);
  }
`;

export interface EmitOptions {
  life: number;
  size: number;
  endSize?: number;
  color: THREE.Color;
  endColor?: THREE.Color;
  drag?: number;
  gravity?: number;
}

/**
 * Additive point-sprite particles in a fixed-size ring buffer.
 * The simulation runs on the CPU (a few thousand particles is cheap). Rendering is one draw call.
 */
export class Particles {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private max: number;
  private cursor = 0;

  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private size1: Float32Array;
  private col0: Float32Array;
  private col1: Float32Array;
  private drag: Float32Array;
  private gravity: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(max = CONFIG.particles.max) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.col0 = new Float32Array(max * 3);
    this.col1 = new Float32Array(max * 3);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader,
      fragmentShader,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }

  /** Point size scale: makes `size` roughly a world-space diameter. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: EmitOptions): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.size0[i] = o.size;
    this.size1[i] = o.endSize ?? 0;
    const c1 = o.endColor ?? o.color;
    this.col0[i3] = o.color.r;
    this.col0[i3 + 1] = o.color.g;
    this.col0[i3 + 2] = o.color.b;
    this.col1[i3] = c1.r;
    this.col1[i3 + 1] = c1.g;
    this.col1[i3 + 2] = c1.b;
    this.drag[i] = o.drag ?? 0;
    this.gravity[i] = o.gravity ?? 0;
  }

  /** Spherical burst, used for explosions and impacts. */
  burst(at: THREE.Vector3, count: number, speed: number, o: EmitOptions, bias?: THREE.Vector3): void {
    for (let n = 0; n < count; n++) {
      // Uniform random direction.
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const v = speed * (0.25 + Math.random() * 0.75);
      const life = o.life * (0.5 + Math.random() * 0.5);
      this.emit(
        at.x,
        at.y,
        at.z,
        s * Math.cos(t) * v + (bias?.x ?? 0),
        s * Math.sin(t) * v + (bias?.y ?? 0),
        u * v + (bias?.z ?? 0),
        { ...o, life, size: o.size * (0.6 + Math.random() * 0.8) },
      );
    }
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i]; // 0 → 1 over the lifetime
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.gravity[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.alpha[i] = 1 - t * t;
      this.col[i3] = this.col0[i3] + (this.col1[i3] - this.col0[i3]) * t;
      this.col[i3 + 1] = this.col0[i3 + 1] + (this.col1[i3 + 1] - this.col0[i3 + 1]) * t;
      this.col[i3 + 2] = this.col0[i3 + 2] + (this.col1[i3 + 2] - this.col0[i3 + 2]) * t;
    }
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
      (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}

/**
 * Dim dust motes floating in the tube. They don't move: the ship flies past them,
 * which sells the speed. Motes behind the ship are recycled ahead.
 */
export class Dust {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private count: number;
  private material: THREE.ShaderMaterial;

  constructor(count: number = CONFIG.particles.dustCount) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    const size = new Float32Array(count).map(() => 0.07 + Math.random() * 0.12);
    const alpha = new Float32Array(count).fill(0.5);
    const col = new Float32Array(count * 3).fill(1.4);
    for (let i = 0; i < count; i++) this.place(i, -Math.random() * CONFIG.particles.dustDepth);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader,
      fragmentShader,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  private place(i: number, z: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (CONFIG.tube.radius - 0.6);
    this.pos[i * 3] = Math.cos(a) * r;
    this.pos[i * 3 + 1] = Math.sin(a) * r;
    this.pos[i * 3 + 2] = z;
  }

  update(shipZ: number): void {
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      const z = this.pos[i * 3 + 2];
      const depth = CONFIG.particles.dustDepth;
      if (z > shipZ + 8 || z < shipZ - depth - 20) {
        this.place(i, shipZ - depth * 0.8 - Math.random() * depth * 0.2);
        dirty = true;
      }
    }
    if (dirty) (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  reset(shipZ: number): void {
    for (let i = 0; i < this.count; i++) this.place(i, shipZ - Math.random() * CONFIG.particles.dustDepth);
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
