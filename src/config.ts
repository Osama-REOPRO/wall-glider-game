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
    /**
     * Distance the ship travels past a wall while it fades out. Keep it below the camera
     * distance so the wall is gone before the camera reaches it.
     */
    fadeDistance: 3.4,
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
  /** Flight aids: cues that make depth readable from the chase camera. Each can be toggled in the Aids panel. */
  aids: {
    /** Collision radius multiplier when the forgiving hitbox is on. */
    forgivingScale: 0.8,
    /** Cues start fading in this many seconds before reaching the wall... */
    fadeStart: 2.0,
    /** ...and are at full strength from this many seconds out. */
    fadeFull: 0.6,
    /** Default distance (world units) from the wall at which the shadow starts to appear. Adjustable in the Aids panel. */
    shadowDistance: 20,
    /** Range offered by the Aids panel slider. */
    shadowDistanceMin: 4,
    shadowDistanceMax: 60,
    /** Shadow edge blur (penumbra half-width) per unit of distance between the ship and the wall. */
    shadowSoftness: 0.03,
    /** Edge blur at contact: crisp, but anti-aliased. */
    shadowMinSoft: 0.02,
    /** Electric arcs reach the next wall from this far away (world units)... */
    arcRange: 14,
    /** ...and the tunnel wall from this far. */
    arcTubeRange: 4,
    /** Headlight cone half-angle (radians): sets how fast the pool tightens. */
    headlightAngle: 0.13,
    headlightIntensity: 900,
  },
  /** Boost ("nitro"): double tap to fly much faster, with much less steering, for one wall's spacing. */
  boost: {
    /** Points for a gap passed while boosting (a normal gap is 1). */
    gapPoints: 2,
    /** Speed multiplier at full boost. */
    speedMultiplier: 1.85,
    /** Steering sensitivity multiplier at full boost (lower = commit to your line before boosting). */
    steerScale: 0.3,
    /** Seconds to reach full boost, and to wind back down after it ends. */
    rampUp: 0.12,
    rampDown: 0.4,
    /** Free flight has no walls, so a boost there lasts this far. */
    freeFlightDistance: 100,
    /** Extra field of view (degrees) at full boost. */
    fovKick: 16,
    /** Double tap: each tap shorter than this (ms) and moving less than this (px)... */
    tapMaxMs: 250,
    tapMaxMove: 14,
    /** ...with the second pressed within this many ms of the first's release, and this many px from it. */
    doubleTapMs: 330,
    doubleTapMaxGap: 70,
  },
  /** Boost pads: violet panels on the tunnel wall that trigger (or extend) the boost when flown over closely. */
  pads: {
    /** Pads can appear from this wall on (0 = the first)... */
    firstWall: 3,
    /** ...in the stretch before a wall, with this probability. */
    chance: 0.4,
    /** Length along the tunnel, and angular width (radians) of each pad. */
    length: 16,
    arc: 0.42,
    /** Trigger when the ship's centre is within this distance of the tunnel wall... */
    triggerDistance: 3.2,
    /** ...and within this many units beyond the pad's side edges. */
    sideMargin: 0.8,
    /** Random spread (radians) around the side of the tunnel facing the next gap. */
    angleJitter: 0.8,
    /** A pad triggered while boosting adds this many wall spacings of boost. */
    extendSpacings: 1,
    pool: 4,
  },
  /** Free-flight mode: open space, no tube, no obstacles. */
  space: {
    speed: 30,
    /** Pitch limit in free flight (radians). Yaw is unlimited. */
    maxPitch: 1.4,
    skyRadius: 850,
    stars: 2600,
    sunDirection: [0.6, 0.35, -0.7],
    planetPosition: [-330, 110, -520],
    /** Side of the cube of dust that wraps around the ship. */
    dustBox: 140,
    dustCount: 2200,
  },
  particles: {
    max: 2400,
    /** How far ahead the dust motes reach. */
    dustDepth: 420,
    dustCount: 700,
    trailRate: 160,
  },
} as const;
