import './style.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG } from './config';
import { Renderer } from './renderer';
import { SteerInput } from './input';
import { Ship } from './ship';
import { Tube } from './tube';
import { Obstacles, ZONES } from './obstacles';
import { Particles, Dust } from './particles';
import { checkCollision } from './collision';
import { Hud } from './hud';

type State = 'title' | 'playing' | 'dead';

const canvas = document.getElementById('game') as HTMLCanvasElement;

// --- Scene -----------------------------------------------------------------
const scene = new THREE.Scene();
const fogColor = new THREE.Color(0x05060d);
scene.background = fogColor;
scene.fog = new THREE.FogExp2(fogColor, 0.0048);

const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.05, 900);
const renderer = new Renderer(canvas, scene, camera);

// A faint image-based environment gives the metal surfaces some reflections.
const pmrem = new THREE.PMREMGenerator(renderer.gl);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.18;
scene.add(new THREE.HemisphereLight(0x6a8cff, 0x120818, 0.35));

const tube = new Tube();
const ship = new Ship();
const obstacles = new Obstacles();
const particles = new Particles();
const dust = new Dust();
// Short-lived light for explosions.
const blastLight = new THREE.PointLight(0xff9a40, 0, 80, 1.3);
scene.add(tube.mesh, ship.group, obstacles.group, particles.points, dust.points, blastLight);

const input = new SteerInput(canvas);
const hud = new Hud();

function applyViewport(): void {
  const h = renderer.gl.domElement.height;
  particles.setViewport(h, camera.fov);
  dust.setViewport(h, camera.fov);
}
hud.onQualityChange = (q) => {
  renderer.setQuality(q);
  applyViewport();
};
renderer.setQuality(hud.savedQuality());
hud.setQualityLabel(hud.savedQuality());
window.addEventListener('resize', applyViewport);
applyViewport();

// --- Game state ------------------------------------------------------------
let state: State = 'title';
let score = 0;
let deadTime = 0;
let timeScale = 1;
let shake = 0;
let zone = -1;
let trailAccumulator = 0;

const camPos = new THREE.Vector3(0, CONFIG.camera.height, CONFIG.camera.distance);
const camLook = new THREE.Vector3(0, 0, -20);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpGap = new THREE.Vector2();

const COLORS = {
  trailHot: new THREE.Color(0.45, 0.85, 1.5),
  trailCool: new THREE.Color(0.35, 0.08, 0.9),
  contrail: new THREE.Color(0.5, 0.8, 1.2),
  fire: new THREE.Color(4.0, 2.6, 1.0),
  ember: new THREE.Color(1.2, 0.15, 0.05),
  spark: new THREE.Color(3.0, 3.0, 3.0),
};

function setZone(n: number): void {
  const z = Math.floor(n / 10) % ZONES.length;
  if (z === zone) return;
  zone = z;
  tube.setAccent(ZONES[z].tube);
}

function resetWorld(): void {
  ship.reset();
  input.reset();
  obstacles.reset(ship.position.z);
  particles.clear();
  dust.reset(ship.position.z);
  score = 0;
  zone = -1;
  setZone(0);
  hud.setScore(0);
  timeScale = 1;
  blastLight.intensity = 0;
  renderer.setAberration(0);
}

function startGame(): void {
  resetWorld();
  state = 'playing';
  input.enabled = true;
  hud.hideOverlay();
}

function crash(point: THREE.Vector3): void {
  state = 'dead';
  deadTime = 0;
  input.enabled = false;
  ship.group.visible = false;
  shake = 1;
  timeScale = 0.35;
  blastLight.position.copy(point).addScaledVector(ship.direction, -1.5);
  blastLight.intensity = 900;
  tmpA.copy(ship.direction).multiplyScalar(ship.speed * 0.15);
  particles.burst(point, 320, 22, { life: 1.4, size: 0.5, endSize: 0.05, color: COLORS.fire, endColor: COLORS.ember, drag: 2.2 }, tmpA);
  particles.burst(point, 120, 30, { life: 0.6, size: 0.18, endSize: 0, color: COLORS.spark, endColor: COLORS.fire, drag: 1.2 });
  try {
    navigator.vibrate?.(120);
  } catch {
    /* vibration not allowed */
  }
}

input.onPress = () => {
  if (state === 'title') startGame();
  else if (state === 'dead' && deadTime > 0.9) startGame();
};

// --- Effects -----------------------------------------------------------------
function emitTrail(dt: number): void {
  trailAccumulator += CONFIG.particles.trailRate * dt;
  const n = Math.floor(trailAccumulator);
  trailAccumulator -= n;
  if (n <= 0) return;
  // Spawn along the path travelled this frame so the trail has no gaps at high speed.
  const tailNow = ship.tailPosition(tmpA);
  const tailPrev = tmpB.copy(ship.prevPosition).addScaledVector(ship.direction, -CONFIG.ship.tailOffset);
  const back = tmpC.copy(ship.direction).multiplyScalar(-5);
  for (let i = 0; i < n; i++) {
    const f = (i + Math.random()) / n;
    particles.emit(
      tailPrev.x + (tailNow.x - tailPrev.x) * f + (Math.random() - 0.5) * 0.07,
      tailPrev.y + (tailNow.y - tailPrev.y) * f + (Math.random() - 0.5) * 0.07,
      tailPrev.z + (tailNow.z - tailPrev.z) * f,
      back.x + (Math.random() - 0.5) * 0.9,
      back.y + (Math.random() - 0.5) * 0.9,
      back.z + (Math.random() - 0.5) * 0.9,
      TRAIL,
    );
  }
  // Thin contrails from the wing tips.
  ship.wingTips(tmpC, tmpD);
  for (const p of [tmpC, tmpD]) {
    particles.emit(p.x, p.y, p.z, 0, 0, 0, CONTRAIL);
  }
}
const TRAIL = { life: 0.5, size: 0.1, endSize: 0.26, color: COLORS.trailHot, endColor: COLORS.trailCool, drag: 1.5 };
const CONTRAIL = { life: 0.4, size: 0.055, endSize: 0.012, color: COLORS.contrail, endColor: COLORS.trailCool };

function passBurst(o: (typeof obstacles.items)[number]): void {
  o.flash = 1;
  const color = o.baseColor.clone().multiplyScalar(3);
  for (let i = 0; i < 120; i++) {
    o.randomRimPoint(tmpA);
    particles.emit(tmpA.x, tmpA.y, tmpA.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, {
      life: 0.8,
      size: 0.32,
      endSize: 0,
      color,
      drag: 1,
    });
  }
}

/** Attract mode: steer toward the next gap so the title screen shows the game being played. */
function autopilot(): [number, number] {
  const next = obstacles.nextAhead(ship.position.z);
  if (!next) return [0, 0];
  next.gapCenter(tmpGap);
  const dist = Math.max(4, ship.position.z - next.z);
  const max = CONFIG.ship.maxAngle * 0.8;
  const yaw = THREE.MathUtils.clamp(Math.atan2(tmpGap.x - ship.position.x, dist) * 1.6, -max, max);
  const pitch = THREE.MathUtils.clamp(Math.atan2(tmpGap.y - ship.position.y, dist) * 1.6, -max, max);
  return [yaw, pitch];
}

function updateCamera(dt: number, realDt: number): void {
  const C = CONFIG.camera;
  const f = C.follow;
  const p = ship.position;
  // Sit behind the ship, pulled toward the tube axis so the way ahead stays readable.
  tmpA.set(p.x * f, p.y * f + C.height, p.z + C.distance);
  const R = CONFIG.tube.radius - 1.2;
  const rad = Math.hypot(tmpA.x, tmpA.y);
  if (rad > R) tmpA.multiplyScalar(R / rad).setZ(p.z + C.distance);
  tmpB.set(
    p.x * 0.92 + ship.direction.x * C.lookAhead * 0.35,
    p.y * 0.92 + ship.direction.y * C.lookAhead * 0.35,
    p.z - C.lookAhead,
  );

  const k = state === 'dead' ? 1 - Math.exp(-2 * dt) : 1 - Math.exp(-9 * dt);
  camPos.lerp(tmpA, k);
  camLook.lerp(tmpB, 1 - Math.exp(-12 * dt));
  camera.position.copy(camPos);
  if (shake > 0) {
    const s = shake * shake * 0.6;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    shake = Math.max(0, shake - realDt * 1.6);
  }
  camera.lookAt(camLook);
  // Roll the camera slightly with the ship's turn for extra motion feel.
  camera.rotateZ(-ship.yaw * 0.25);

  // Widen the field of view with speed.
  const speedT = (ship.speed - CONFIG.ship.startSpeed) / (CONFIG.ship.maxSpeed - CONFIG.ship.startSpeed);
  const fov = C.fov + speedT * 12;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-3 * dt));
    camera.updateProjectionMatrix();
    applyViewport();
  }
}

// --- Main loop -------------------------------------------------------------
let last = performance.now();
const frameTimes: number[] = [];

function frame(now: number): void {
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frameTimes.push(realDt);
  if (frameTimes.length > 120) frameTimes.shift();

  if (state === 'dead') {
    deadTime += realDt;
    timeScale += (1 - timeScale) * (1 - Math.exp(-1.5 * realDt));
    if (deadTime > 0.9 && deadTime - realDt <= 0.9) hud.showGameOver(score);
  }
  const dt = realDt * timeScale;

  if (state === 'title') {
    const [yaw, pitch] = autopilot();
    ship.speed = CONFIG.ship.startSpeed * 0.8;
    ship.update(dt, yaw, pitch); // attract mode: no collisions
  } else if (state === 'playing') {
    ship.speed = Math.min(CONFIG.ship.maxSpeed, CONFIG.ship.startSpeed + score * CONFIG.ship.speedPerRing);
    ship.update(dt, input.yaw, input.pitch);
    const hit = checkCollision(ship.prevPosition, ship.position, obstacles.items);
    if (hit.type === 'wall' || hit.type === 'obstacle') {
      crash(hit.point);
    } else if (hit.type === 'passed') {
      score++;
      hud.setScore(score, true);
      passBurst(hit.obstacle);
      setZone(score);
    }
  }

  if (state !== 'dead') emitTrail(dt);

  obstacles.update(dt, ship.position.z);
  tube.update(ship.position.z);
  dust.update(ship.position.z);
  particles.update(dt);
  if (blastLight.intensity > 0) blastLight.intensity = Math.max(0, blastLight.intensity * Math.exp(-3.5 * realDt) - 0.5);
  updateCamera(dt, realDt);
  renderer.setAberration(state === 'dead' ? shake * 0.08 : 0.004 + (ship.speed - CONFIG.ship.startSpeed) * 0.0006);
  renderer.render();
  requestAnimationFrame(frame);
}

resetWorld();
hud.showTitle();
requestAnimationFrame(frame);

// Debug/test hooks (used by automated browser tests).
(window as unknown as { __game: unknown }).__game = {
  get state() {
    return state;
  },
  get score() {
    return score;
  },
  ship,
  input,
  obstacles,
  fps: () => frameTimes.length / frameTimes.reduce((a, b) => a + b, 0),
  start: startGame,
};
