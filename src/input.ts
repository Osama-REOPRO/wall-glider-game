import { CONFIG } from './config';

/**
 * Converts finger/mouse drags into heading changes.
 * Dragging moves the ship's nose: right → yaw right, up → pitch up.
 * The heading is held when the finger lifts (the player only controls direction).
 */
export class SteerInput {
  /** Accumulated target heading in radians. */
  yaw = 0;
  pitch = 0;
  /** Fires on any tap/press (used for start/restart). */
  onPress: (() => void) | null = null;

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
      if (!this.enabled) return;
      const scale = CONFIG.ship.steerSensitivity / Math.min(window.innerWidth, window.innerHeight);
      this.yaw += dx * scale;
      this.pitch -= dy * scale;
      this.clamp();
      e.preventDefault();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.activeId) this.activeId = null;
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    // Keyboard fallback for desktop testing.
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') this.onPress?.();
      if (!this.enabled) return;
      const step = 0.06;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.yaw -= step;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.yaw += step;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') this.pitch += step;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') this.pitch -= step;
      this.clamp();
    });
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
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
