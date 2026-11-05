/** Tunable game constants. Everything that affects feel lives here. */
export const CONFIG = {
  tube: {
    radius: 6,
    /** World length of one texture panel; the tube mesh snaps by this so the texture looks static. */
    panelLength: 8,
    /** Visible length of the tube mesh ahead of the ship. */
    length: 240,
    radialSegments: 48,
  },
  ship: {
    /** Collision radius of the ship (a sphere approximation). */
    radius: 0.42,
    startSpeed: 22,
    maxSpeed: 44,
    /** Speed gained per ring passed. */
    speedPerRing: 0.55,
    /** Radians of heading change per screen-width of finger travel. */
    steerSensitivity: 1.8,
    /** Max angle (radians) between the heading and the tube axis. */
    maxAngle: 0.55,
    /** How quickly the rendered heading follows the target heading (1/s). */
    steerSmoothing: 14,
  },
  obstacles: {
    firstAt: 70,
    startSpacing: 46,
    minSpacing: 26,
    spacingPerRing: 0.6,
    startHole: 2.7,
    minHole: 1.55,
    holePerRing: 0.035,
    thickness: 0.7,
    /** How many rings exist at once (pooled). */
    poolSize: 7,
  },
  camera: {
    fov: 70,
    distance: 5.0,
    height: 1.9,
    /** 0 = camera stays on tube axis, 1 = camera fully follows ship laterally. */
    follow: 0.72,
  },
  particles: {
    max: 2400,
    trailRate: 160,
  },
} as const;
