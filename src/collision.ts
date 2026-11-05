import * as THREE from 'three';
import { CONFIG } from './config';
import type { Obstacle } from './obstacles';

export type Hit =
  | { type: 'none' }
  | { type: 'wall'; point: THREE.Vector3 }
  | { type: 'obstacle'; point: THREE.Vector3; obstacle: Obstacle }
  | { type: 'passed'; obstacle: Obstacle };

const hitPoint = new THREE.Vector3();

/**
 * Analytic collision. The ship is a sphere. The tube is a cylinder, so the wall test is a radius check.
 * Each wall is a slab of fixed thickness. If the ship's path this frame overlaps the slab,
 * we test the ship's position where it crosses the slab's mid-plane against the gap shape.
 * That makes the test immune to tunnelling at high speed.
 */
export function checkCollision(prev: THREE.Vector3, curr: THREE.Vector3, obstacles: readonly Obstacle[]): Hit {
  const shipR = CONFIG.ship.radius;
  const R = CONFIG.tube.radius;

  const radial = Math.hypot(curr.x, curr.y);
  if (radial + shipR >= R) {
    const s = R / Math.max(radial, 1e-6);
    hitPoint.set(curr.x * s, curr.y * s, curr.z);
    return { type: 'wall', point: hitPoint };
  }

  const half = CONFIG.obstacles.thickness / 2 + 0.08 + shipR * 0.6;
  for (const o of obstacles) {
    if (o.passed) continue;
    const zMax = Math.max(prev.z, curr.z);
    const zMin = Math.min(prev.z, curr.z);
    if (zMax < o.z - half || zMin > o.z + half) continue;
    // Position where the path crosses the wall's mid-plane (or the closest point of this frame's step).
    const dz = curr.z - prev.z;
    const t = Math.abs(dz) > 1e-6 ? THREE.MathUtils.clamp((o.z - prev.z) / dz, 0, 1) : 1;
    const x = prev.x + (curr.x - prev.x) * t;
    const y = prev.y + (curr.y - prev.y) * t;
    if (!o.fits(x, y, shipR + 0.08)) {
      hitPoint.set(x, y, o.z + CONFIG.obstacles.thickness / 2);
      return { type: 'obstacle', point: hitPoint, obstacle: o };
    }
    if (curr.z < o.z - half) {
      o.passed = true;
      return { type: 'passed', obstacle: o };
    }
  }
  return { type: 'none' };
}
