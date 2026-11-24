import { CONFIG } from './config';

/**
 * Game presets for the tunnel. Classic is the original game (the default); Fast is the later variant
 * where the boost feel became normal flight in a tunnel twice as wide. A preset overwrites these
 * CONFIG values when a run starts; everything else is shared.
 */
export type Preset = 'classic' | 'fast';

const PRESETS: Record<Preset, Record<string, Record<string, number>>> = {
  classic: {
    tube: { radius: 16, radialSegments: 96, panelsAround: 32 },
    ship: { startSpeed: 30, maxSpeed: 56, speedPerRing: 0.6, steerSensitivity: 1.8 },
    obstacles: { firstAt: 130, startSpacing: 95, minSpacing: 55, spacingPerRing: 1.2 },
    camera: { fov: 70 },
    controls: { rollSensitivity: 3.2 },
    keyboard: { steerRate: 1.1 },
    boost: { speedMultiplier: 1.85, steerScale: 0.3, fovKick: 16 },
    pads: { arc: 0.42 },
    space: { speed: 30 },
  },
  fast: {
    tube: { radius: 32, radialSegments: 160, panelsAround: 64 },
    ship: { startSpeed: 55, maxSpeed: 104, speedPerRing: 1.1, steerSensitivity: 0.54 },
    obstacles: { firstAt: 220, startSpacing: 190, minSpacing: 110, spacingPerRing: 2.4 },
    camera: { fov: 86 },
    controls: { rollSensitivity: 0.96 },
    keyboard: { steerRate: 0.33 },
    boost: { speedMultiplier: 1.4, steerScale: 0.6, fovKick: 10 },
    pads: { arc: 0.21 },
    space: { speed: 55 },
  },
};

/** Overwrite CONFIG with a preset's values. CONFIG is `as const` for typing only; it's a plain object at runtime. */
export function applyPreset(p: Preset): void {
  const cfg = CONFIG as unknown as Record<string, Record<string, unknown>>;
  for (const [section, values] of Object.entries(PRESETS[p])) {
    const target = section === 'keyboard' ? (cfg.controls.keyboard as Record<string, unknown>) : cfg[section];
    Object.assign(target, values);
  }
}
