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
import { Space } from './space';
import { ProjectedShadow, predict, hitRadius, type Prediction } from './aids';

type State = 'title' | 'playing' | 'dead';
/** 'tunnel' is the game. 'free' is open space with no obstacles, for testing the controls. */
type Mode = 'tunnel' | 'free';

const canvas = document.getElementById('game') as HTMLCanvasElement;

// --- Scene -----------------------------------------------------------------
const scene = new THREE.Scene();
const fogColor = new THREE.Color(0x05060d);
const tunnelFog = new THREE.FogExp2(fogColor, 0.0048);
scene.background = fogColor;
scene.fog = tunnelFog;

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
const shadow = new ProjectedShadow();
scene.add(shadow.group);
const space = new Space();
space.group.visible = false;
scene.add(space.group);

const input = new SteerInput(canvas);
const hud = new Hud();

function applyViewport(): void {
  const h = renderer.gl.domElement.height;
  particles.setViewport(h, camera.fov);
  dust.setViewport(h, camera.fov);
  space.setViewport(h, camera.fov);
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
let mode: Mode = 'tunnel';
let readoutTimer = 0;
let prediction: Prediction | null = null;
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
  clearAids();
  // Snap the camera behind the ship so a mode change doesn't swoop across the world.
  camPos.set(0, CONFIG.camera.height, CONFIG.camera.distance);
  camLook.set(0, 0, -CONFIG.camera.lookAhead);
  renderer.setAberration(0);
}

/** Show the scenery for a mode and set the matching control limits. */
function setMode(m: Mode): void {
  mode = m;
  const tunnel = m === 'tunnel';
  tube.mesh.visible = tunnel;
  obstacles.group.visible = tunnel;
  dust.points.visible = tunnel;
  space.group.visible = !tunnel;
  scene.fog = tunnel ? tunnelFog : null;
  input.limits = tunnel ? 'cone' : 'free';
  ship.axisBank = tunnel;
}

function startGame(): void {
  setMode('tunnel');
  resetWorld();
  state = 'playing';
  input.enabled = true;
  hud.showRun();
}

function startFreeFlight(): void {
  setMode('free');
  resetWorld();
  ship.speed = CONFIG.space.speed;
  state = 'playing';
  input.enabled = true;
  hud.showFreeFlight();
}

function toMenu(): void {
  setMode('tunnel');
  resetWorld();
  state = 'title';
  input.enabled = false;
  hud.showTitle();
}

hud.onTunnel = startGame;
hud.onFree = startFreeFlight;
hud.onExit = toMenu;

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
  if (mode === 'free') return;
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

/**
 * Flight aids: predict where the ship crosses the next wall at the heading it's steering to,
 * then drive the projected shadow and the rim warning from that one prediction.
 */
function updateAids(yaw: number, pitch: number): void {
  const radius = hitRadius(hud.aids);
  prediction = predict(ship.position, yaw, pitch, ship.speed, obstacles, radius);
  for (const o of obstacles.items) o.warn = 0;
  if (!prediction) {
    shadow.hide();
    return;
  }
  if (hud.aids.rim && prediction.outcome === 'wall') prediction.obstacle.warn = prediction.strength;
  shadow.speedHint = ship.speed;
  if (hud.aids.shadow) shadow.show(prediction, ship.bank, radius);
  else shadow.hide();
}

function clearAids(): void {
  prediction = null;
  shadow.hide();
  for (const o of obstacles.items) o.warn = 0;
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

/** Free flight: a plain chase camera behind and above the ship's heading. */
function updateFreeCamera(dt: number): void {
  const C = CONFIG.camera;
  const p = ship.position;
  tmpA.copy(p).addScaledVector(ship.direction, -C.distance);
  tmpA.y += C.height;
  tmpB.copy(p).addScaledVector(ship.direction, C.lookAhead * 0.5);
  camPos.lerp(tmpA, 1 - Math.exp(-9 * dt));
  camLook.lerp(tmpB, 1 - Math.exp(-12 * dt));
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

function updateReadout(dt: number): void {
  readoutTimer -= dt;
  if (readoutTimer > 0) return;
  readoutTimer = 0.1;
  const deg = THREE.MathUtils.radToDeg;
  const heading = ((deg(ship.yaw) % 360) + 360) % 360;
  hud.setReadout(`HDG ${heading.toFixed(0).padStart(3, '0')}° · PITCH ${deg(ship.pitch).toFixed(0)}° · ${ship.speed.toFixed(0)} u/s`);
}

function updateCamera(dt: number, realDt: number): void {
  if (mode === 'free') {
    updateFreeCamera(dt);
    return;
  }
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

  if (mode === 'free') {
    ship.speed = CONFIG.space.speed;
    ship.update(dt, input.yaw, input.pitch); // no collisions in free flight
    updateReadout(realDt);
  } else if (state === 'title') {
    const [yaw, pitch] = autopilot();
    ship.speed = CONFIG.ship.startSpeed * 0.8;
    ship.update(dt, yaw, pitch); // attract mode: no collisions
    updateAids(yaw, pitch);
  } else if (state === 'playing') {
    ship.speed = Math.min(CONFIG.ship.maxSpeed, CONFIG.ship.startSpeed + score * CONFIG.ship.speedPerRing);
    ship.update(dt, input.yaw, input.pitch);
    updateAids(input.yaw, input.pitch);
    const hit = checkCollision(ship.prevPosition, ship.position, obstacles.items, hitRadius(hud.aids));
    if (hit.type === 'wall' || hit.type === 'obstacle') {
      crash(hit.point);
    } else if (hit.type === 'passed') {
      score++;
      hud.setScore(score, true);
      passBurst(hit.obstacle);
      setZone(score);
    }
  }

  if (state === 'dead' || mode === 'free') clearAids();
  if (state !== 'dead') emitTrail(dt);

  if (mode === 'tunnel') {
    obstacles.update(dt, ship.position.z);
    tube.update(ship.position.z);
    dust.update(ship.position.z);
  }
  particles.update(dt);
  if (blastLight.intensity > 0) blastLight.intensity = Math.max(0, blastLight.intensity * Math.exp(-3.5 * realDt) - 0.5);
  updateCamera(dt, realDt);
  if (mode === 'free') space.update(dt, camera, ship.position);
  renderer.setAberration(state === 'dead' ? shake * 0.08 : 0.004 + (ship.speed - CONFIG.ship.startSpeed) * 0.0006);
  renderer.render();
  requestAnimationFrame(frame);
}

// A link ending in #free opens straight into free flight.
if (location.hash === '#free') startFreeFlight();
else toMenu();
window.addEventListener('hashchange', () => {
  if (location.hash === '#free' && mode !== 'free') startFreeFlight();
});
requestAnimationFrame(frame);

// Debug/test hooks (used by automated browser tests).
(window as unknown as { __game: unknown }).__game = {
  get state() {
    return state;
  },
  get score() {
    return score;
  },
  get mode() {
    return mode;
  },
  get prediction() {
    return (
      prediction && {
        outcome: prediction.outcome,
        tti: prediction.timeToImpact,
        strength: prediction.strength,
        x: prediction.point.x,
        y: prediction.point.y,
        z: prediction.obstacle.z,
      }
    );
  },
  aids: hud.aids,
  shadow,
  ship,
  input,
  obstacles,
  fps: () => frameTimes.length / frameTimes.reduce((a, b) => a + b, 0),
  start: startGame,
  startFree: startFreeFlight,
  menu: toMenu,
};
