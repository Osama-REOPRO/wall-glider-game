import * as THREE from 'three';
import { CONFIG } from './config';
import { createTubeMaps } from './textures';

/**
 * The endless tube is a single open cylinder that follows the ship.
 * It snaps forward in whole texture periods, so the texture appears fixed in world space
 * while the mesh never has to be rebuilt. One draw call.
 */
export class Tube {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  private period: number;

  constructor() {
    const { radius, length, radialSegments, panelLength } = CONFIG.tube;
    const geo = new THREE.CylinderGeometry(radius, radius, length, radialSegments, 1, true);
    geo.rotateX(Math.PI / 2); // axis along Z

    const maps = createTubeMaps();
    // The texture holds 2×2 panels. 12 panels around the circumference.
    this.period = panelLength * 2;
    const repeatU = 6;
    const repeatV = length / this.period;
    for (const t of Object.values(maps)) t.repeat.set(repeatU, repeatV);

    this.material = new THREE.MeshStandardMaterial({
      map: maps.map,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(1, 1),
      roughnessMap: maps.roughnessMap,
      roughness: 0.75,
      metalness: 0.55,
      emissiveMap: maps.emissiveMap,
      emissive: new THREE.Color(0x3fd8ff),
      emissiveIntensity: 1.25,
      side: THREE.BackSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Keep the tube around the ship: about 20 units behind it, the rest ahead. */
  update(shipZ: number): void {
    const snapped = Math.round(shipZ / this.period) * this.period;
    this.mesh.position.z = snapped - (CONFIG.tube.length / 2 - 24);
  }

  setAccent(color: THREE.Color): void {
    this.material.emissive.copy(color);
  }
}
