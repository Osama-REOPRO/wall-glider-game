import * as THREE from 'three';
import { CONFIG } from './config';
import { createGlowTexture } from './textures';

/** The player's triangular ship and its flight model. */
export class Ship {
  readonly group = new THREE.Group();
  /** Inner group that carries the visual banking so the light and exhaust stay level. */
  private body = new THREE.Group();
  readonly light: THREE.PointLight;
  /** Full intensity of the ship light; `dimForWall()` scales it down close to a wall. */
  readonly lightIntensity = 160;
  /** How far ahead of the ship the light sits. */
  readonly lightAhead = 9;
  private engineGlow: THREE.Sprite;
  private hullMat: THREE.MeshStandardMaterial;

  readonly position = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  readonly direction = new THREE.Vector3(0, 0, -1);
  speed: number = CONFIG.ship.startSpeed;
  yaw = 0;
  pitch = 0;
  private roll = 0;
  /** Tunnel mode adds extra bank from the heading's offset to the tube axis. Off in free flight. */
  axisBank = true;
  private time = 0;

  constructor() {
    // Arrowhead silhouette: nose forward (+Y in shape space → −Z in world).
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.15);
    shape.lineTo(0.78, -0.62);
    shape.lineTo(0, -0.34);
    shape.lineTo(-0.78, -0.62);
    shape.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.05,
      bevelSegments: 2,
    });
    hullGeo.translate(0, 0, -0.06);
    hullGeo.rotateX(-Math.PI / 2);

    this.hullMat = new THREE.MeshStandardMaterial({
      color: 0x8d9aab,
      metalness: 0.85,
      roughness: 0.32,
      emissive: 0x1c4258,
    });
    const hull = new THREE.Mesh(hullGeo, this.hullMat);

    // Dorsal ridge / cockpit: a thinner, taller triangle on top.
    const ridgeShape = new THREE.Shape();
    ridgeShape.moveTo(0, 0.7);
    ridgeShape.lineTo(0.2, -0.3);
    ridgeShape.lineTo(-0.2, -0.3);
    ridgeShape.closePath();
    const ridgeGeo = new THREE.ExtrudeGeometry(ridgeShape, {
      depth: 0.1,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.06,
      bevelSegments: 2,
    });
    ridgeGeo.rotateX(-Math.PI / 2);
    ridgeGeo.translate(0, 0.1, 0);
    const ridge = new THREE.Mesh(
      ridgeGeo,
      new THREE.MeshStandardMaterial({ color: 0x0d1626, metalness: 0.2, roughness: 0.1, emissive: 0x1a6080, emissiveIntensity: 0.8 }),
    );

    // Glowing edge outline (bloom turns this into a neon rim).
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(hullGeo, 30),
      new THREE.LineBasicMaterial({ color: new THREE.Color(0x5ff3ff).multiplyScalar(2.4) }),
    );

    // Engine nozzles at the rear notch.
    const nozzleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.75, 0.45).multiplyScalar(1.5) });
    for (const x of [-0.22, 0.22]) {
      const nozzle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.06), nozzleMat);
      nozzle.position.set(x, 0, 0.42);
      this.body.add(nozzle);
    }

    this.engineGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createGlowTexture(),
        color: new THREE.Color(1.0, 0.6, 0.3).multiplyScalar(0.7),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.engineGlow.scale.set(1.4, 1.4, 1);
    this.engineGlow.position.set(0, 0, 0.55);

    this.body.add(hull, ridge, edges, this.engineGlow);
    this.body.scale.setScalar(CONFIG.ship.scale);
    this.group.add(this.body);

    // Light carried by the ship: it lights the tube walls as the ship flies past them.
    this.light = new THREE.PointLight(0x9feaff, this.lightIntensity, 60, 1.5);
    this.light.position.set(0, 0.3, -this.lightAhead);
    this.group.add(this.light);
  }

  /**
   * Keep the lit pool on an approaching wall at a steady brightness instead of letting it flare to
   * white (which, with bloom, would wash out the ship's shadow right where the player is looking).
   * `wallDist` is the distance from the ship to the wall along the tunnel, or null for none.
   */
  dimForWall(wallDist: number | null): void {
    const SAFE = 12; // light-to-wall distance at which the pool is as bright as it should get
    if (wallDist === null) {
      this.light.intensity = this.lightIntensity;
      return;
    }
    const lightToWall = Math.max(1, wallDist - this.lightAhead * -this.direction.z);
    this.light.intensity = this.lightIntensity * Math.min(1, Math.pow(lightToWall / SAFE, 1.5));
  }

  /** Current visual bank angle (radians). */
  get bank(): number {
    return this.roll;
  }

  reset(): void {
    this.position.set(0, 0, 0);
    this.prevPosition.copy(this.position);
    this.speed = CONFIG.ship.startSpeed;
    this.yaw = this.pitch = this.roll = 0;
    this.group.visible = true;
    this.sync();
  }

  /** Move the ship, easing its heading toward the target heading. */
  update(dt: number, targetYaw: number, targetPitch: number): void {
    this.time += dt;
    const k = 1 - Math.exp(-CONFIG.ship.steerSmoothing * dt);
    const prevYaw = this.yaw;
    this.yaw += (targetYaw - this.yaw) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    const yawRate = dt > 0 ? (this.yaw - prevYaw) / dt : 0;
    // Bank into turns: right turn → right wing down. A little roll also comes from the heading itself.
    const axisRoll = this.axisBank ? -this.yaw * 0.6 : 0;
    const targetRoll = THREE.MathUtils.clamp(-yawRate * 0.35 + axisRoll, -1.1, 1.1);
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-8 * dt));

    const cp = Math.cos(this.pitch);
    this.direction.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);

    this.prevPosition.copy(this.position);
    this.position.addScaledVector(this.direction, this.speed * dt);
    this.sync();

    // Engine flicker.
    const f = 1 + Math.sin(this.time * 60) * 0.08 + Math.sin(this.time * 23) * 0.06;
    this.engineGlow.scale.setScalar(0.55 * f);
  }

  /** World-space point just behind the engines, where the exhaust trail is emitted. */
  tailPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.direction).multiplyScalar(-CONFIG.ship.tailOffset).add(this.position);
  }

  /** Wing-tip positions for the thin contrails. */
  wingTips(left: THREE.Vector3, right: THREE.Vector3): void {
    this.body.updateWorldMatrix(true, false);
    left.set(-0.74, 0, 0.55).applyMatrix4(this.body.matrixWorld);
    right.set(0.74, 0, 0.55).applyMatrix4(this.body.matrixWorld);
  }

  private sync(): void {
    this.group.position.copy(this.position);
    this.group.rotation.set(this.pitch, -this.yaw, 0, 'YXZ');
    this.body.rotation.set(0, 0, this.roll);
  }
}
