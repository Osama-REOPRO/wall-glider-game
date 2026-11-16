import * as THREE from 'three';
import { CONFIG } from './config';

/**
 * 'steer': drag moves the nose directly (sideways = yaw, up/down = pitch).
 * 'rollpitch': sideways rolls the ship around its nose, up/down pitches it relative to its own wings,
 * like a plane: roll first, then pull up to turn in that direction.
 */
export type ControlScheme = 'steer' | 'rollpitch';

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const FORWARD = new THREE.Vector3(0, 0, -1);
const qStep = new THREE.Quaternion();
const qFix = new THREE.Quaternion();
const vDir = new THREE.Vector3();
const vClamped = new THREE.Vector3();

/**
 * Converts finger/mouse drags into heading changes.
 * Dragging moves the ship's nose: right → yaw right, up → pitch up.
 * The heading is held when the finger lifts (the player only controls direction).
 */
export class SteerInput {
  /** Accumulated target heading in radians (steer scheme). */
  yaw = 0;
  pitch = 0;
  /** Target orientation (roll + pitch scheme). */
  readonly target = new THREE.Quaternion();
  scheme: ControlScheme = 'steer';
  /** Fires on any tap/press (used for start/restart). */
  onPress: (() => void) | null = null;
  /** Fires on a quick double tap (two short taps close together in time and place). */
  onDoubleTap: (() => void) | null = null;
  /** Multiplier on steering sensitivity (lowered while boosting). */
  steerScale = 1;

  /** Tap tracking for double-tap detection. */
  private downTime = 0;
  private downX = 0;
  private downY = 0;
  private travel = 0;
  private lastTapTime = -1e9;
  private lastTapX = 0;
  private lastTapY = 0;

  private activeId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  enabled = false;
  /**
   * 'cone': heading stays within CONFIG.ship.maxAngle of the tube axis (tunnel mode).
   * 'free': unlimited yaw, pitch capped short of straight up/down (free flight).
   */
  limits: 'cone' | 'free' = 'cone';

  constructor(target: HTMLElement) {
    target.addEventListener('pointerdown', (e) => {
      if (this.activeId !== null) return;
      this.activeId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.downTime = performance.now();
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.travel = 0;
      target.setPointerCapture?.(e.pointerId);
      this.onPress?.();
      e.preventDefault();
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.activeId) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.travel += Math.hypot(dx, dy);
      if (!this.enabled) return;
      const scale = (CONFIG.ship.steerSensitivity * this.steerScale) / Math.min(window.innerWidth, window.innerHeight);
      this.apply(dx * scale, -dy * scale);
      e.preventDefault();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.activeId) this.activeId = null;
    };
    target.addEventListener('pointerup', (e) => {
      if (e.pointerId === this.activeId) this.detectTap(e.clientX, e.clientY);
      end(e);
    });
    target.addEventListener('pointercancel', end);
    // Keyboard fallback for desktop testing.
    window.addEventListener('keydown', (e) => {
      // Keys aimed at a focused button or checkbox belong to it, not to the game.
      if (e.target instanceof HTMLElement && e.target.closest('button, input, label')) return;
      if (e.code === 'Space' || e.code === 'Enter') this.onPress?.();
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyB') this.onDoubleTap?.();
      if (!this.enabled) return;
      const step = 0.06 * this.steerScale;
      let sx = 0;
      let sy = 0;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') sx -= step;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') sx += step;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') sy += step;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') sy -= step;
      this.apply(sx, sy);
    });
  }

  /**
   * A tap is a short press that barely moved, so it never fights with steering drags.
   * Two taps close together in time and place make a double tap.
   */
  private detectTap(x: number, y: number): void {
    const B = CONFIG.boost;
    const now = performance.now();
    const isTap = now - this.downTime < B.tapMaxMs && this.travel < B.tapMaxMove && Math.hypot(x - this.downX, y - this.downY) < B.tapMaxMove;
    if (!isTap) {
      this.lastTapTime = -1e9;
      return;
    }
    // The gap is measured from the first tap's release to the second tap's press.
    if (this.downTime - this.lastTapTime < B.doubleTapMs && Math.hypot(x - this.lastTapX, y - this.lastTapY) < B.doubleTapMaxGap) {
      this.lastTapTime = -1e9; // a third tap starts a new pair
      this.onDoubleTap?.();
      return;
    }
    this.lastTapTime = now;
    this.lastTapX = x;
    this.lastTapY = y;
  }

  /**
   * One steering input: `sx` from sideways movement, `sy` from vertical (up is positive), in radians.
   */
  private apply(sx: number, sy: number): void {
    if (this.scheme === 'steer') {
      this.yaw += sx;
      this.pitch += sy;
      this.clamp();
      return;
    }
    // Roll + pitch, both about the ship's own axes. Sliding right rolls right (right wing down).
    const rollScale = CONFIG.controls.rollSensitivity / CONFIG.ship.steerSensitivity;
    this.target.multiply(qStep.setFromAxisAngle(AXIS_Z, -sx * rollScale));
    this.target.multiply(qStep.setFromAxisAngle(AXIS_X, sy));
    this.target.normalize();
    if (this.limits === 'cone') this.clampOrientation();
  }

  /** Tunnel: if the nose has left the cone, rotate it back onto the cone's edge, keeping the roll. */
  private clampOrientation(): void {
    const max = CONFIG.ship.maxAngle;
    vDir.copy(FORWARD).applyQuaternion(this.target);
    const angle = vDir.angleTo(FORWARD);
    if (angle <= max) return;
    // The point on the cone's edge in the same direction around the axis.
    const lateral = Math.hypot(vDir.x, vDir.y) || 1;
    vClamped.set((vDir.x / lateral) * Math.sin(max), (vDir.y / lateral) * Math.sin(max), -Math.cos(max));
    this.target.premultiply(qFix.setFromUnitVectors(vDir, vClamped));
  }

  /** Switch scheme, carrying over the current heading so the ship doesn't jump. */
  setScheme(scheme: ControlScheme, orientation: THREE.Quaternion, yaw: number, pitch: number): void {
    this.scheme = scheme;
    this.target.copy(orientation);
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Where the player is steering to: the nose direction of the target heading. */
  targetDirection(out: THREE.Vector3): THREE.Vector3 {
    if (this.scheme === 'rollpitch') return out.copy(FORWARD).applyQuaternion(this.target);
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.target.identity();
  }

  /** Keep the heading inside the current limits. */
  private clamp(): void {
    if (this.limits === 'free') {
      const mp = CONFIG.space.maxPitch;
      this.pitch = Math.max(-mp, Math.min(mp, this.pitch));
      return;
    }
    // Tunnel: a cone around the tube axis, so the ship can never turn backwards.
    const max = CONFIG.ship.maxAngle;
    const mag = Math.hypot(this.yaw, this.pitch);
    if (mag > max) {
      this.yaw *= max / mag;
      this.pitch *= max / mag;
    }
  }
}
