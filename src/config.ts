/** Tunable game constants. Everything that affects feel lives here. */
export const CONFIG = {
  tube: {
    radius: 16,
    /** World length of one texture panel; the tube mesh snaps by this so the texture looks static. */
    panelLength: 8,
    /** Visible length of the tube mesh ahead of the ship. */
    length: 560,
    radialSegments: 96,
    /** Hull panels around the circumference (must be even: the texture holds 2×2 panels). */
    panelsAround: 32,
  },
  ship: {
    /** Visual scale of the ship model (1 = original size). */
    scale: 0.6,
    /** Collision radius of the ship (a sphere approximation). */
    radius: 0.26,
    /** Distance from the ship's centre to its engines. */
    tailOffset: 0.33,
    startSpeed: 30,
    maxSpeed: 56,
    /** Speed gained per ring passed. */
    speedPerRing: 0.6,
    /** Radians of heading change per screen-width of finger travel. */
    steerSensitivity: 1.8,
    /** Max angle (radians) between the heading and the tube axis. */
    maxAngle: 0.55,
    /** How quickly the rendered heading follows the target heading (1/s). */
    steerSmoothing: 14,
  },
  obstacles: {
    firstAt: 130,
    startSpacing: 95,
    minSpacing: 55,
    spacingPerRing: 1.2,
    startHole: 5.5,
    minHole: 2.4,
    holePerRing: 0.09,
    thickness: 1.6,
    /** How many rings exist at once (pooled). */
    poolSize: 7,
  },
  camera: {
    fov: 70,
    distance: 6.0,
    height: 1.7,
    /** 0 = camera stays on tube axis, 1 = camera fully follows ship laterally. */
    follow: 0.85,
    /** How far ahead of the ship the camera aims. */
    lookAhead: 32,
  },
  particles: {
    max: 2400,
    /** How far ahead the dust motes reach. */
    dustDepth: 420,
    dustCount: 700,
    trailRate: 160,
  },
} as const;
