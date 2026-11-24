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

  private maps: ReturnType<typeof createTubeMaps>;

  constructor() {
    const maps = createTubeMaps();
    this.maps = maps;
    this.period = CONFIG.tube.panelLength * 2;

    this.material = new THREE.MeshStandardMaterial({
      map: maps.map,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(1, 1),
      roughnessMap: maps.roughnessMap,
      roughness: 0.75,
      metalness: 0.55,
      emissiveMap: maps.emissiveMap,
      emissive: new THREE.Color(0x3fd8ff),
      emissiveIntensity: 1.1,
      side: THREE.BackSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.rebuild();
  }

  /** (Re)build the cylinder from CONFIG.tube, e.g. after a preset changed the radius. */
  rebuild(): void {
    const { radius, length, radialSegments, panelsAround } = CONFIG.tube;
    const geo = new THREE.CylinderGeometry(radius, radius, length, radialSegments, 1, true);
    geo.rotateX(Math.PI / 2); // axis along Z
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    // The texture holds 2×2 panels.
    for (const t of Object.values(this.maps)) t.repeat.set(panelsAround / 2, length / this.period);
  }

  /** Keep the tube around the ship: about 20 units behind it, the rest ahead. */
  update(shipZ: number): void {
    const snapped = Math.round(shipZ / this.period) * this.period;
    this.mesh.position.z = snapped - (CONFIG.tube.length / 2 - 40);
  }

  setAccent(color: THREE.Color): void {
    this.material.emissive.copy(color);
  }
}
