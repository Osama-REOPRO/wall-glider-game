import * as THREE from 'three';
import { CONFIG } from './config';
import { createGlowTexture } from './textures';

/**
 * Open-space scene for free flight: nebula sky, stars, a distant planet and sun, and a cloud of
 * dust motes that wraps around the ship on every axis, so motion is always visible.
 * The sky, stars, planet and sun follow the camera, so they read as infinitely far away.
 */

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 271.9))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  void main() {
    vec3 d = normalize(vDir);
    float n1 = fbm(d * 2.2);
    float n2 = fbm(d * 4.0 + vec3(5.2, 1.3, 7.7));
    vec3 base = vec3(0.008, 0.01, 0.025);
    vec3 violet = vec3(0.22, 0.05, 0.32) * smoothstep(0.45, 0.85, n1);
    vec3 teal = vec3(0.02, 0.17, 0.24) * smoothstep(0.5, 0.9, n2);
    // A faint band across the sky, like a galactic plane.
    float band = exp(-pow(d.y + 0.25 * sin(d.x * 2.0), 2.0) * 18.0) * 0.08;
    gl_FragColor = vec4(base + violet + teal + vec3(0.08, 0.07, 0.12) * band, 1.0);
  }
`;

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
  }
`;

const starFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(vColor * pow(1.0 - r, 2.5), 1.0);
  }
`;

// Dust motes live in a cube around uCenter. The shader wraps each one back into the cube
// as the ship moves, so the cloud is endless at zero CPU cost.
const dustVertex = /* glsl */ `
  attribute float aSize;
  uniform vec3 uCenter;
  uniform float uBox;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec3 hb = vec3(uBox * 0.5);
    vec3 p = uCenter + mod(position - uCenter + hb, uBox) - hb;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    // Fade toward the cube's edges so wrapping never pops.
    float edge = length(p - uCenter) / (uBox * 0.5);
    vAlpha = 1.0 - smoothstep(0.55, 0.95, edge);
  }
`;

const dustFragment = /* glsl */ `
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(vec3(0.9, 1.05, 1.35) * pow(1.0 - r, 1.4), vAlpha);
  }
`;

function planetTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  // Gas-giant bands.
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const b = Math.sin(t * 38) * 0.5 + Math.sin(t * 91 + 1.3) * 0.25 + Math.sin(t * 13) * 0.25;
    const r = 150 + b * 50;
    const g = 110 + b * 40;
    const bl = 140 + b * 60;
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${bl | 0})`;
    ctx.fillRect(0, y, W, 1);
  }
  // Storms.
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(255,230,240,${0.03 + Math.random() * 0.06})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * W, Math.random() * H, 10 + Math.random() * 40, 2 + Math.random() * 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class Space {
  readonly group = new THREE.Group();
  /** Things that sit "at infinity": moved to the camera every frame. */
  private far = new THREE.Group();
  private dustMaterial: THREE.ShaderMaterial;
  private sunLight: THREE.DirectionalLight;
  private planet: THREE.Mesh;

  constructor() {
    const S = CONFIG.space;

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(S.skyRadius, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    sky.renderOrder = -2;
    this.far.add(sky);

    // Stars on a sphere just inside the sky.
    const n = S.stars;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.randomDirection().multiplyScalar(S.skyRadius * 0.95);
      pos.set([v.x, v.y, v.z], i * 3);
      const bright = Math.pow(Math.random(), 6);
      size[i] = 1.5 + bright * 4;
      const tint = Math.random();
      const k = 0.5 + bright * 2.5;
      col.set([k * (0.8 + tint * 0.2), k * 0.9, k * (1.1 - tint * 0.3)], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    starGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.ShaderMaterial({ vertexShader: starVertex, fragmentShader: starFragment, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    stars.renderOrder = -1;
    stars.frustumCulled = false;
    this.far.add(stars);

    // Sun: glow sprite plus a directional light from the same direction.
    const sunDir = new THREE.Vector3(...S.sunDirection).normalize();
    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createGlowTexture(),
        color: new THREE.Color(3.0, 2.4, 1.6),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
      }),
    );
    sun.position.copy(sunDir).multiplyScalar(S.skyRadius * 0.8);
    sun.scale.setScalar(110);
    sun.renderOrder = -1;
    this.far.add(sun);

    this.sunLight = new THREE.DirectionalLight(0xfff1dd, 1.1);
    this.sunLight.position.copy(sunDir);
    this.group.add(this.sunLight, this.sunLight.target);

    // Distant gas giant as a fixed landmark for orientation.
    this.planet = new THREE.Mesh(
      new THREE.SphereGeometry(90, 64, 32),
      new THREE.MeshStandardMaterial({ map: planetTexture(), roughness: 0.9, metalness: 0, fog: false }),
    );
    this.planet.position.set(...S.planetPosition);
    this.planet.rotation.set(0.35, 0, 0.2);
    this.far.add(this.planet);

    // Dust cloud.
    const dn = S.dustCount;
    const dpos = new Float32Array(dn * 3);
    const dsize = new Float32Array(dn);
    for (let i = 0; i < dn; i++) {
      dpos[i * 3] = (Math.random() - 0.5) * S.dustBox;
      dpos[i * 3 + 1] = (Math.random() - 0.5) * S.dustBox;
      dpos[i * 3 + 2] = (Math.random() - 0.5) * S.dustBox;
      dsize[i] = 0.18 + Math.random() * 0.3;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dsize, 1));
    this.dustMaterial = new THREE.ShaderMaterial({
      uniforms: { uCenter: { value: new THREE.Vector3() }, uBox: { value: S.dustBox }, uScale: { value: 400 } },
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const dust = new THREE.Points(dustGeo, this.dustMaterial);
    dust.frustumCulled = false;

    this.group.add(this.far, dust);
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.dustMaterial.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  update(dt: number, camera: THREE.Camera, shipPos: THREE.Vector3): void {
    this.far.position.copy(camera.position);
    this.dustMaterial.uniforms.uCenter.value.copy(shipPos);
    // Keep the sun's light aimed through the ship.
    this.sunLight.target.position.copy(shipPos);
    this.sunLight.position.copy(shipPos).add(this.sunDirection);
    this.planet.rotation.y += dt * 0.01;
  }

  private get sunDirection(): THREE.Vector3 {
    return tmpSun.set(...CONFIG.space.sunDirection).normalize();
  }
}

const tmpSun = new THREE.Vector3();
