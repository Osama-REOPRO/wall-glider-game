import * as THREE from 'three';

/**
 * "Sky castle" test level: high in a planet's atmosphere, above a sea of clouds, near an enormous
 * floating citadel. It is so large (about 1.4 km across, 1.5 km tall) that fog and cloud banks hide most
 * of it at any moment. A look-and-feel test for clouds, fog and scale: no collisions, no objectives.
 *
 * Everything is procedural (no assets):
 * - Sky dome shader: zenith blue to a pale horizon haze, with a sun disc and glow.
 * - Sea of clouds: a huge plane far below with an animated noise shader, lit from the sun.
 * - Cloud banks: ~1,000 soft billboard puffs, sorted back to front, shaded lighter on top.
 * - The citadel: a rock underside with hanging spikes, terraced walls with battlements, towers
 *   with conical roofs, a central keep with spires, trees, waterfalls, and satellite islands.
 * - Exponential fog in the horizon colour, so distance fades everything into the haze.
 */

const SUN_DIR = new THREE.Vector3(0.55, 0.45, -0.7).normalize();
export const SKY_HAZE = new THREE.Color(0xc9d9e6);
const SEA_Y = -900;

// ------------------------------------------------------------------------------------------
// Small deterministic helpers

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap smooth 3D noise for displacing rock (sum of sines, deterministic). */
function rockNoise(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 0.011 + Math.sin(z * 0.013) * 2) * 0.5 +
    Math.sin(z * 0.017 + y * 0.009) * 0.3 +
    Math.sin((x + z) * 0.031 + y * 0.02) * 0.2
  );
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------------------------------
// Textures

function stoneTexture(windows: boolean): THREE.CanvasTexture {
  const rnd = mulberry32(windows ? 11 : 5);
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#b9ab95';
    ctx.fillRect(0, 0, 256, 256);
    // Courses of ashlar blocks with staggered joints.
    const bh = 16;
    for (let row = 0; row < 256 / bh; row++) {
      let x = row % 2 ? -14 : 0;
      while (x < 256) {
        const bw = 24 + rnd() * 20;
        const tone = 160 + rnd() * 40;
        ctx.fillStyle = `rgb(${tone + 12},${tone + 4},${tone - 12})`;
        ctx.fillRect(x + 1, row * bh + 1, bw - 2, bh - 2);
        x += bw;
      }
    }
    // Weathering streaks.
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(70,75,70,${0.04 + rnd() * 0.06})`;
      ctx.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 4, 30 + rnd() * 90);
    }
    if (windows) {
      // Narrow arched window slits.
      for (let i = 0; i < 4; i++) {
        const x = 20 + i * 64;
        for (const y of [40, 168]) {
          ctx.fillStyle = '#2a2622';
          ctx.fillRect(x, y, 10, 34);
          ctx.beginPath();
          ctx.arc(x + 5, y, 5, Math.PI, 0);
          ctx.fill();
        }
      }
    }
  });
}

function rockTexture(): THREE.CanvasTexture {
  const rnd = mulberry32(21);
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#7c7266';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      const t = 90 + rnd() * 70;
      ctx.fillStyle = `rgba(${t},${t - 8},${t - 18},${0.25 + rnd() * 0.4})`;
      const s = 2 + rnd() * 10;
      ctx.fillRect(rnd() * 256, rnd() * 256, s, s * (0.3 + rnd()));
    }
    // Strata.
    for (let y = 0; y < 256; y += 9 + rnd() * 14) {
      ctx.fillStyle = `rgba(40,34,30,${0.15 + rnd() * 0.2})`;
      ctx.fillRect(0, y, 256, 1 + rnd() * 3);
    }
  });
}

function puffTexture(): THREE.CanvasTexture {
  const rnd = mulberry32(3);
  return canvasTexture(
    128,
    128,
    (ctx) => {
      // Overlapping soft lobes make a cauliflower-edged puff.
      for (let i = 0; i < 18; i++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * 26;
        const x = 64 + Math.cos(a) * d;
        const y = 66 + Math.sin(a) * d * 0.8;
        const r = 18 + rnd() * 22;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
      }
    },
    false,
  );
}

// ------------------------------------------------------------------------------------------
// Sky dome

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uHaze;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    vec3 zenith = vec3(0.16, 0.36, 0.72);
    vec3 col = mix(uHaze, zenith, pow(clamp(d.y, 0.0, 1.0), 0.55));
    // Below the horizon: the haze over the sea of clouds.
    col = mix(col, uHaze * 1.02, smoothstep(0.0, -0.08, d.y));
    float s = max(dot(d, uSun), 0.0);
    col += vec3(1.0, 0.86, 0.62) * (pow(s, 8.0) * 0.25 + pow(s, 64.0) * 0.5);
    col += vec3(1.6, 1.5, 1.3) * smoothstep(0.9993, 0.9997, s); // sun disc
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ------------------------------------------------------------------------------------------
// Sea of clouds

const seaVertex = /* glsl */ `
  varying vec3 vWorld;
  varying float vDepth;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const seaFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSun;
  uniform vec3 uHaze;
  uniform float uFog;
  varying vec3 vWorld;
  varying float vDepth;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
    return v;
  }
  void main() {
    vec2 p = vWorld.xz * 0.0016 + vec2(uTime * 0.004, uTime * 0.0025);
    float h = fbm(p);
    // Fake lighting: brighter where the cloud surface rises toward the sun.
    float hs = fbm(p + uSun.xz * 0.02);
    float lit = clamp(0.75 + (h - hs) * 6.0, 0.45, 1.15);
    float cover = smoothstep(0.32, 0.62, h);
    vec3 cloud = vec3(0.97, 0.97, 1.0) * lit;
    vec3 deep = vec3(0.55, 0.65, 0.76); // gaps: the haze far below
    vec3 col = mix(deep, cloud, cover);
    float fog = 1.0 - exp(-uFog * uFog * vDepth * vDepth);
    gl_FragColor = vec4(mix(col, uHaze, fog), 1.0);
  }
`;

// ------------------------------------------------------------------------------------------
// Cloud puffs (camera-facing billboards, sorted back to front)

const puffVertex = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aSize;
  attribute float aShade;
  varying vec2 vUv;
  varying float vShade;
  varying float vDepth;
  varying float vLift;
  void main() {
    vUv = uv;
    vShade = aShade;
    vLift = position.y + 0.5;
    vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
    mv.xy += position.xy * aSize;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const puffFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uHaze;
  uniform float uFog;
  uniform vec3 uSunCol;
  varying vec2 vUv;
  varying float vShade;
  varying float vDepth;
  varying float vLift;
  void main() {
    float a = texture2D(uMap, vUv).a;
    if (a < 0.01) discard;
    // Lit from above: bright sunlit tops, cooler shaded bellies.
    vec3 belly = vec3(0.68, 0.73, 0.82);
    vec3 top = uSunCol;
    vec3 col = mix(belly, top, clamp(vLift * 0.9 + vShade * 0.35, 0.0, 1.0));
    float fog = 1.0 - exp(-uFog * uFog * vDepth * vDepth);
    col = mix(col, uHaze, fog);
    // Fade puffs the camera is about to fly through, so they never pop.
    float near = smoothstep(4.0, 60.0, vDepth);
    gl_FragColor = vec4(col, a * near);
  }
`;

class CloudPuffs {
  readonly mesh: THREE.Mesh;
  private centers: Float32Array;
  private sizes: Float32Array;
  private shades: Float32Array;
  private count: number;
  private order: number[];
  private dist: Float32Array;
  private src: { c: Float32Array; s: Float32Array; h: Float32Array };
  private geo: THREE.InstancedBufferGeometry;

  constructor(puffs: { x: number; y: number; z: number; size: number; shade: number }[], fogDensity: number) {
    this.count = puffs.length;
    this.src = {
      c: new Float32Array(puffs.flatMap((p) => [p.x, p.y, p.z])),
      s: new Float32Array(puffs.map((p) => p.size)),
      h: new Float32Array(puffs.map((p) => p.shade)),
    };
    this.centers = new Float32Array(this.src.c);
    this.sizes = new Float32Array(this.src.s);
    this.shades = new Float32Array(this.src.h);
    this.order = puffs.map((_, i) => i);
    this.dist = new Float32Array(this.count);
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(this.centers, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aShade', new THREE.InstancedBufferAttribute(this.shades, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = this.count;
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: puffTexture() },
          uHaze: { value: SKY_HAZE },
          uFog: { value: fogDensity },
          uSunCol: { value: new THREE.Color(1.0, 0.98, 0.94) },
        },
        vertexShader: puffVertex,
        fragmentShader: puffFragment,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** Sort back to front from the camera (a few hundred puffs: cheap). */
  sort(cam: THREE.Vector3): void {
    const c = this.src.c;
    for (let i = 0; i < this.count; i++) {
      const dx = c[i * 3] - cam.x;
      const dy = c[i * 3 + 1] - cam.y;
      const dz = c[i * 3 + 2] - cam.z;
      this.dist[i] = dx * dx + dy * dy + dz * dz;
    }
    this.order.sort((a, b) => this.dist[b] - this.dist[a]);
    for (let k = 0; k < this.count; k++) {
      const i = this.order[k];
      this.centers[k * 3] = c[i * 3];
      this.centers[k * 3 + 1] = c[i * 3 + 1];
      this.centers[k * 3 + 2] = c[i * 3 + 2];
      this.sizes[k] = this.src.s[i];
      this.shades[k] = this.src.h[i];
    }
    for (const n of ['aCenter', 'aSize', 'aShade']) (this.geo.getAttribute(n) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}

// ------------------------------------------------------------------------------------------
// Waterfalls

const fallVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fallFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uHaze;
  uniform float uFog;
  varying vec2 vUv;
  varying float vDepth;
  float hash(float x) { return fract(sin(x * 91.7) * 43758.5); }
  void main() {
    // Streaks running down, spreading into mist toward the bottom.
    float col = floor(vUv.x * 40.0);
    float streak = fract(vUv.y * 3.0 + uTime * (0.35 + hash(col) * 0.3) + hash(col + 3.0));
    float s = smoothstep(0.0, 0.25, streak) * (0.55 + 0.45 * hash(col + 7.0));
    float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
    float mist = smoothstep(0.0, 0.7, 1.0 - vUv.y);
    float a = edge * mix(s * 0.75, 0.35, mist) * (1.0 - smoothstep(0.85, 1.0, 1.0 - vUv.y));
    vec3 c = mix(vec3(0.85, 0.92, 1.0), uHaze, 1.0 - exp(-uFog * uFog * vDepth * vDepth));
    gl_FragColor = vec4(c, a);
  }
`;

// ------------------------------------------------------------------------------------------

export class SkyLevel {
  readonly group = new THREE.Group();
  readonly fog: THREE.FogExp2;
  /** Where the ship starts, and the direction it faces (toward the citadel). */
  readonly start = new THREE.Vector3(-260, 120, 1500);
  private dome: THREE.Mesh;
  private sea: THREE.Mesh;
  private seaUniforms: Record<string, THREE.IUniform>;
  private puffs: CloudPuffs;
  private fallUniforms: Record<string, THREE.IUniform>;
  private sortTimer = 0;
  private time = 0;

  constructor() {
    // Dense enough that the far side of the citadel (1.4 km across) dissolves into the haze.
    const fogDensity = 0.0009;
    this.fog = new THREE.FogExp2(SKY_HAZE, fogDensity);

    // Sky dome.
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(8000, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: { uSun: { value: SUN_DIR }, uHaze: { value: SKY_HAZE } },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.dome.renderOrder = -2;
    this.group.add(this.dome);

    // Sea of clouds far below.
    this.seaUniforms = { uTime: { value: 0 }, uSun: { value: SUN_DIR }, uHaze: { value: SKY_HAZE }, uFog: { value: fogDensity * 0.8 } };
    this.sea = new THREE.Mesh(
      new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({ uniforms: this.seaUniforms, vertexShader: seaVertex, fragmentShader: seaFragment }),
    );
    this.sea.position.y = SEA_Y;
    this.group.add(this.sea);

    // Light: a warm sun and a sky/cloud bounce fill.
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(1000);
    this.group.add(sun, sun.target);
    this.group.add(new THREE.HemisphereLight(0xa9cdf5, 0xe9e2d6, 1.1));

    // The citadel and its satellite islands.
    const castle = buildCitadel();
    this.group.add(castle.group);
    this.fallUniforms = castle.fallUniforms;
    this.fallUniforms.uFog.value = fogDensity;

    // Cloud banks.
    this.puffs = new CloudPuffs(buildCloudPuffs(), fogDensity);
    this.group.add(this.puffs.mesh);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    this.dome.position.copy(camera.position);
    // The sea follows the camera (its noise is in world space, so it doesn't appear to move).
    this.sea.position.x = camera.position.x;
    this.sea.position.z = camera.position.z;
    this.seaUniforms.uTime.value = this.time;
    this.fallUniforms.uTime.value = this.time;
    this.sortTimer -= dt;
    if (this.sortTimer <= 0) {
      this.sortTimer = 0.1;
      this.puffs.sort(camera.position);
    }
  }
}

// ------------------------------------------------------------------------------------------
// The citadel

function buildCitadel(): { group: THREE.Group; fallUniforms: Record<string, THREE.IUniform> } {
  const g = new THREE.Group();
  const rnd = mulberry32(1234);

  const rockTex = rockTexture();
  rockTex.repeat.set(6, 4);
  const rock = new THREE.MeshStandardMaterial({ map: rockTex, color: 0xd8cfc2, roughness: 0.95, flatShading: true });
  const stoneTex = stoneTexture(false);
  stoneTex.repeat.set(24, 2);
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.88 });
  const towerTex = stoneTexture(true);
  towerTex.repeat.set(3, 3);
  const towerStone = new THREE.MeshStandardMaterial({ map: towerTex, roughness: 0.88 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x4f8f86, roughness: 0.55, metalness: 0.35 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x6f9a4a, roughness: 1 });
  const leaves = new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 0.9, flatShading: true });
  const plain = new THREE.MeshStandardMaterial({ color: 0xc8bda9, roughness: 0.85 });

  // --- Rock underside: an inverted, craggy cone ---------------------------------------------
  const rockMesh = (topR: number, depth: number, seed: number) => {
    const prof: THREE.Vector2[] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = topR * Math.pow(1 - t, 0.75) * (1 - 0.05 * Math.sin(t * 9 + seed));
      prof.push(new THREE.Vector2(Math.max(r, 0.001), -t * depth));
    }
    // Tip first, rim last: this winding makes the faces point outward.
    prof.reverse();
    const geo = new THREE.LatheGeometry(prof, 56);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (y > -2) continue; // keep the top rim flat for the terraces
      const n = rockNoise(x + seed * 100, y, z);
      const s = 1 + n * 0.14;
      pos.setXYZ(i, x * s, y + n * depth * 0.03, z * s);
    }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, rock);
  };
  g.add(rockMesh(760, 1050, 1));
  // Close the rock's top between its rim and the lowest wall.
  const rim = new THREE.Mesh(new THREE.RingGeometry(690, 762, 96).rotateX(-Math.PI / 2), grass);
  rim.position.y = 0.5;
  g.add(rim);

  // Hanging rock spikes under the island.
  const spikeGeo = new THREE.ConeGeometry(1, 1, 7).rotateX(Math.PI); // point down
  const spikes = new THREE.InstancedMesh(spikeGeo, rock, 34);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < 34; i++) {
    const a = rnd() * Math.PI * 2;
    const t = 0.15 + rnd() * 0.7; // how far down the underside
    const r = 760 * Math.pow(1 - t, 0.75) * 0.9;
    const len = 120 + rnd() * 380;
    const w = 25 + rnd() * 70;
    p.set(Math.cos(a) * r, -t * 1050 - len * 0.4, Math.sin(a) * r);
    q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3));
    spikes.setMatrixAt(i, m.compose(p, q, sc.set(w, len, w)));
  }
  g.add(spikes);

  // --- Terraces: four stone tiers stepping up and inward ------------------------------------
  const tiers = [
    { r: 700, top: 40, h: 80 },
    { r: 520, top: 150, h: 110 },
    { r: 360, top: 300, h: 150 },
    { r: 210, top: 480, h: 180 },
  ];
  const crenGeo = new THREE.BoxGeometry(1, 1, 1);
  const towerGeo = new THREE.CylinderGeometry(1, 1.06, 1, 20);
  const roofGeo = new THREE.ConeGeometry(1, 1, 20);
  const treeGeo = new THREE.ConeGeometry(1, 1, 7);
  type Inst = { pos: THREE.Vector3; scale: THREE.Vector3; rotY?: number };
  const crens: Inst[] = [];
  const towers: Inst[] = [];
  const roofs: Inst[] = [];
  const trees: Inst[] = [];

  const addTower = (x: number, y: number, z: number, r: number, h: number, roofH: number) => {
    towers.push({ pos: new THREE.Vector3(x, y + h / 2, z), scale: new THREE.Vector3(r, h, r) });
    roofs.push({ pos: new THREE.Vector3(x, y + h + roofH / 2, z), scale: new THREE.Vector3(r * 1.25, roofH, r * 1.25) });
    // A ring of battlements around the tower top.
    const n = Math.max(6, Math.round(r / 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      crens.push({ pos: new THREE.Vector3(x + Math.cos(a) * r * 1.02, y + h - 2, z + Math.sin(a) * r * 1.02), scale: new THREE.Vector3(3, 6, 3), rotY: -a });
    }
  };

  for (const [ti, t] of tiers.entries()) {
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r * 1.03, t.h, 96, 1, true), stone);
    wall.position.y = t.top - t.h / 2;
    g.add(wall);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(t.r, 96).rotateX(-Math.PI / 2), grass);
    cap.position.y = t.top;
    g.add(cap);
    // Battlements along the rim: alternating merlons.
    const n = Math.round((t.r * Math.PI * 2) / 14);
    for (let k = 0; k < n; k += 2) {
      const a = (k / n) * Math.PI * 2;
      crens.push({ pos: new THREE.Vector3(Math.cos(a) * t.r, t.top + 4, Math.sin(a) * t.r), scale: new THREE.Vector3(7, 8, 4), rotY: -a });
    }
    // Towers on the rim.
    const count = [18, 12, 9, 6][ti];
    const tr = [26, 30, 34, 38][ti];
    const th = [110, 140, 170, 210][ti];
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + ti * 0.3;
      const hh = th * (0.8 + rnd() * 0.5);
      addTower(Math.cos(a) * t.r, t.top - 20, Math.sin(a) * t.r, tr * (0.85 + rnd() * 0.3), hh, tr * 2.2);
    }
    // Trees and buildings in the gardens of each tier.
    const inner = ti < 3 ? tiers[ti + 1].r : 0;
    for (let k = 0; k < [90, 60, 30, 0][ti]; k++) {
      const a = rnd() * Math.PI * 2;
      const d = inner + 30 + rnd() * (t.r - inner - 60);
      const s = 10 + rnd() * 14;
      trees.push({ pos: new THREE.Vector3(Math.cos(a) * d, t.top + s * 1.4, Math.sin(a) * d), scale: new THREE.Vector3(s, s * 2.8, s) });
    }
    for (let k = 0; k < [14, 10, 6, 0][ti]; k++) {
      const a = rnd() * Math.PI * 2;
      const d = inner + 50 + rnd() * (t.r - inner - 100);
      const w = 30 + rnd() * 40;
      const h = 30 + rnd() * 50;
      const house = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.7), plain);
      house.position.set(Math.cos(a) * d, t.top + h / 2, Math.sin(a) * d);
      house.rotation.y = rnd() * Math.PI;
      g.add(house);
      const hr = new THREE.Mesh(new THREE.ConeGeometry(w * 0.75, h * 0.7, 4), roof);
      hr.position.set(house.position.x, t.top + h + h * 0.35, house.position.z);
      hr.rotation.y = house.rotation.y + Math.PI / 4;
      g.add(hr);
    }
  }

  // --- Central keep: a cluster of tall towers and spires -------------------------------------
  addTower(0, 480, 0, 90, 380, 220);
  addTower(110, 480, 40, 45, 520, 170);
  addTower(-90, 480, 70, 40, 470, 150);
  addTower(-30, 480, -110, 50, 600, 200);
  addTower(60, 480, -80, 30, 700, 160);

  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Inst[]) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const e = new THREE.Euler();
    list.forEach((it, i) => {
      q.setFromEuler(e.set(0, it.rotY ?? 0, 0));
      mesh.setMatrixAt(i, m.compose(it.pos, q, it.scale));
    });
    g.add(mesh);
  };
  instanced(crenGeo, stone, crens);
  instanced(towerGeo, towerStone, towers);
  instanced(roofGeo, roof, roofs);
  instanced(treeGeo, leaves, trees);

  // --- Waterfalls pouring off the lowest terrace into the clouds -----------------------------
  const fallUniforms: Record<string, THREE.IUniform> = { uTime: { value: 0 }, uHaze: { value: SKY_HAZE }, uFog: { value: 0 } };
  const fallMat = new THREE.ShaderMaterial({
    uniforms: fallUniforms,
    vertexShader: fallVertex,
    fragmentShader: fallFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (const a of [0.4, 2.3, 4.1]) {
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(60, 1100), fallMat);
    fall.position.set(Math.cos(a) * 712, 40 - 550, Math.sin(a) * 712);
    fall.rotation.y = -a + Math.PI / 2;
    fall.renderOrder = 4;
    g.add(fall);
  }

  // --- Satellite islands, each with a lone tower ---------------------------------------------
  const sats = [
    { x: 1150, y: 260, z: 380, r: 120 },
    { x: -1050, y: -120, z: 620, r: 150 },
    { x: 420, y: 520, z: -1250, r: 90 },
    { x: -720, y: 340, z: -950, r: 110 },
    { x: 1400, y: -260, z: -500, r: 170 },
  ];
  for (const [i, s] of sats.entries()) {
    const island = rockMesh(s.r, s.r * 1.6, i + 7);
    island.position.set(s.x, s.y, s.z);
    g.add(island);
    const top = new THREE.Mesh(new THREE.CircleGeometry(s.r * 1.02, 32).rotateX(-Math.PI / 2), grass);
    top.position.set(s.x, s.y + 0.5, s.z);
    g.add(top);
    const tw = new THREE.Mesh(towerGeo, towerStone);
    const tr = s.r * 0.22;
    const th = s.r * 1.3;
    tw.scale.set(tr, th, tr);
    tw.position.set(s.x, s.y + th / 2, s.z);
    g.add(tw);
    const rf = new THREE.Mesh(roofGeo, roof);
    rf.scale.set(tr * 1.25, tr * 2.2, tr * 1.25);
    rf.position.set(s.x, s.y + th + tr * 1.1, s.z);
    g.add(rf);
  }

  return { group: g, fallUniforms };
}

// ------------------------------------------------------------------------------------------
// Where the clouds go

function buildCloudPuffs(): { x: number; y: number; z: number; size: number; shade: number }[] {
  const rnd = mulberry32(99);
  const out: { x: number; y: number; z: number; size: number; shade: number }[] = [];
  /** A cluster: a flattened blob of puffs, bigger and brighter on top. */
  const cluster = (cx: number, cy: number, cz: number, rx: number, ry: number, n: number, size: number) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd());
      const yy = (rnd() * 2 - 1) * ry;
      out.push({
        x: cx + Math.cos(a) * d * rx,
        y: cy + yy,
        z: cz + Math.sin(a) * d * rx * (0.6 + rnd() * 0.8),
        size: size * (0.6 + rnd() * 0.8) * (1 - Math.abs(yy) / (ry * 2.2)),
        shade: yy / ry,
      });
    }
  };
  // A thick collar of cloud around the underside, hiding where the rock ends.
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.2;
    const r = 650 + rnd() * 450;
    cluster(Math.cos(a) * r, -380 - rnd() * 300, Math.sin(a) * r, 260, 90, 18, 260);
  }
  // A veil drifting across the upper towers on the far side, so the top fades in and out of view.
  for (let i = 0; i < 8; i++) {
    const a = -0.6 + i * 0.35;
    cluster(Math.cos(a) * 500, 560 + rnd() * 260, -Math.abs(Math.sin(a)) * 600 - 250, 220, 60, 14, 220);
  }
  // Banks scattered through the sky at all heights.
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 1300 + rnd() * 2600;
    cluster(Math.cos(a) * r, -500 + rnd() * 1400, Math.sin(a) * r, 300 + rnd() * 300, 80, 16, 300);
  }
  // A few small clouds along the approach, to fly through.
  for (let i = 0; i < 6; i++) cluster(-260 + (rnd() - 0.5) * 500, 60 + rnd() * 200, 1700 - i * 230, 90, 30, 8, 110);
  return out;
}
