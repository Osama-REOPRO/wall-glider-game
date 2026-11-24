# Wall Glider design notes

This file records the design decisions made so far: what we chose, why, and what we turned down. Any change that makes a design decision updates this file in the same commit. Tunable numbers live in `src/config.ts`; this file explains the reasoning behind them.

## Guiding principles

### Keep cues in the world, not in the UI

> "After I added those indicators to make it clearer where you are headed and compensate for limited depth info, when the indicators are too prominent the game stops being about steering a ship and starts being about 'moving a cursor inside a circle quickly'. I really don't like that, so let's reduce UI assistance as much as possible so you are immersed in the world rather than looking at UI. Let's keep all the cues in world, as much as possible."
>
> (the designer, after playtesting the target markers)

This principle overrides convenience. When the player needs information, look first for a way the world itself can show it: a shadow, light, colour, motion or sound coming from the scene. Use an interface overlay only as a last resort, and keep it subtle and off by default. A cue that turns flying into aiming a cursor at a target has failed, however clear it is.

What this means in practice:
- Flight aids are grouped **In world** (shadow, rim warning), **Interface** (target markers) and **Rules** (forgiving hitbox). The Interface group is **off by default** and stays available only for comparison in playtests.
- New readability problems get an in-world solution first.

## The game in one paragraph

A small triangular ship flies forward on its own down an endless tunnel. The player controls only its heading: dragging a finger turns the nose, and the ship flies wherever the nose points. Walls cross the tunnel, each with a gap to fly through. Touching a wall or the tunnel ends the run. The target is a vertical slice: one loop, polished close to final visual quality, tested by opening a URL on a phone.

## Technology

| Decision | Why | Turned down |
|---|---|---|
| **Three.js + TypeScript + Vite**, running in the browser | Testing is "open a URL on a phone". A Three.js build is about 160 KB gzipped and loads instantly in mobile Safari and Chrome. Bloom, emissive materials and particles cost little on mobile GPUs. The same build can later be wrapped with Capacitor for the app stores. | **Unity WebGL:** 10–30 MB builds and heavy on iOS memory. **Godot 4 web:** only the Compatibility renderer, a large wasm download, and known iOS Safari problems. |
| Three.js's built-in `UnrealBloomPass` | Does the job and saves a dependency. | The `postprocessing` package from the first plan. |
| **Procedural textures** drawn on canvases at startup (hull panels, normal maps via Sobel from a height map, emissive light strips, hazard stripes, a gas giant) | No asset files, a tiny build, and easy to retune. | Image assets. |
| **Analytic collision**, no physics engine | The world is a cylinder and flat walls, so exact maths is simpler, cheaper and doesn't tunnel through walls at high speed. | A physics engine. |
| Deterministic PRNG for textures | Textures look the same on every load. | — |

## Controls

### Classic and Fast modes

The tunnel game has two modes on the menu, set up as presets (`src/presets.ts`) that overwrite the relevant config values when a run starts:
- **Classic (the default):** the original game. Speed 30 to 56, full steering sensitivity (1.8; roll 3.2; keyboard 1.1 rad/s), a 70° view, a tunnel of radius 16, and walls 95 apart, tightening to 55. Boost is 1.85× speed with steering cut to 30%. Tapping the menu background starts Classic, and free flight and the sky castle fly with Classic handling.
- **Fast:** the variant described below, in a tunnel of radius 32 with walls twice as far apart. Also reachable with a link ending in `#fast`.
- Retry replays the same mode, and each mode keeps its own best score (Classic keeps the original record).
- Why: the designer wanted the original version back as the default, keeping the fast version as its own mode.

### The Fast mode: boost feel as normal flight

The designer liked how the ship handled while boosting, so after an experiment on a separate branch that feel became normal flight in what is now the Fast mode:
- **Speed** starts at 55 and rises to 104 (`ship.startSpeed`, `maxSpeed`). That's 1.85× the original 30 to 56.
- **Steering** is 30% of the original sensitivity: `steerSensitivity` 0.54 (was 1.8), `rollSensitivity` 0.96 (was 3.2), keyboard 0.33 rad/s (was 1.1).
- **View:** the field of view is 86° (was 70°).
- **Effects stay calm:** the nitro flame, speed lines and strong colour fringe are still reserved for boosting.
- **Wall spacing was later doubled** (start 95 → 190, minimum 55 → 110, first wall at 220), because at the new speed walls came twice as often and the game had become too hard. Walls now arrive at roughly the original rate. Gap sizes are unchanged. The game is about choosing your line early, not correcting late.

- **Drag sets the heading, and it holds when you lift your finger.** The brief said the only control is direction. Steering is relative: heading change = finger travel × `steerSensitivity` per screen width.
- **Tunnel: the heading stays within a cone (0.55 rad) around the tunnel axis**, so the ship can never turn around and fly backwards.
- **Free flight: yaw is unlimited and pitch is capped at 1.4 rad (~80°).** Capping just short of vertical avoids the camera and the yaw/pitch maths flipping over.
- The heading is **smoothed** toward the target (`steerSmoothing`) so it doesn't jitter.
- **The ship banks into turns**, which tells the player what the ship is doing. In the tunnel it also banks with its offset from the axis; that's turned off in free flight, where yaw has no limit.
- **Keyboard controls for desktop browsers.** Arrow keys or WASD steer while held, at a steady 0.33 rad/s (`controls.keyboard.steerRate`), scaled by boost like finger steering. In roll + pitch, left/right roll and up/down pitch. Space or Enter starts and retries, Shift or B boosts, and Escape goes back to the menu. Releasing a key holds the heading, the same as lifting a finger. Keys are cleared if the window loses focus, and keys aimed at a focused button or checkbox are left to it. On a desktop (mouse/trackpad as the main pointer) the title screen shows the keyboard controls instead of the touch ones. The mouse still drags to steer.
- Open question: whether the heading should drift back to centre when the finger lifts.

### Control schemes

The designer is exploring alternatives. The scheme is chosen in the **Controls** section at the top of the Aids panel, can be switched mid-run without the heading jumping, and is saved per browser.

| Scheme | Sideways drag | Vertical drag |
|---|---|---|
| **Steer** (default, the original) | Turns the nose left/right (yaw) | Turns the nose up/down (pitch) |
| **Roll + pitch** | Rolls the ship around its nose (sliding right rolls right) | Pitches up/down relative to the ship's own wings |

- **Roll + pitch flies like a plane:** to turn right, roll right, then pull up. Sliding sideways alone never changes where the ship is going; only pitch does. Both rotations are about the ship's own axes, so the orientation is a full quaternion (no gimbal lock, and loops work in free flight).
- **Roll sensitivity** is set separately (`controls.rollSensitivity`, 0.96 rad per screen width): a quarter-width slide rolls about 14°. Pitch uses the normal steering sensitivity. Boost cuts both.
- **The camera sits directly behind the ship and rolls with it** (the designer's call). In both the tunnel and free flight it rides behind the nose and just above the ship's own wings, a rigid chase camera, so "pull up" always means up on screen and the tunnel turns around you. The roll follow is `cameraRollFollow` (1 = fully). In the tunnel it's clamped inside the tunnel wall if the ship hugs the wall with its wings pointing at it. The steer scheme keeps the axis-pulled camera described under Camera.
- **The tunnel's 31.5° cone limit still applies.** If a pitch would take the nose outside the cone, the nose is moved back onto the cone's edge and the roll is kept.
- **Shared parts:** the flight aids predict along the target heading in either scheme, and the shadow turns with the real bank angle. The title-screen autopilot always uses the steer scheme.

## Boost

A risk/reward move for advanced players who want to go faster, asked for by the designer.

- **Double tap to boost** ("nitro"). Boost is an extra tier on top of the already fast normal flight. (It used to be 1.85× speed with steering at 30%; that feel became normal flight, see Controls.) The ship flies **1.4× faster** (`speedMultiplier`) for **one wall's spacing**: the distance from the next wall to the one after it. In free flight, where there are no walls, a boost lasts 100 units. It ramps up in 0.12 s and winds down over 0.4 s.
- **While boosting, steering drops to 60% of normal** (`steerScale`), about 18% of the original sensitivity: the same drag turns the ship much less. **That's the core of the design.** You have to line up with the next gap *before* you boost, because you won't have the manoeuvrability to correct afterwards. Boost rewards planning, not reflexes. Keyboard steering is scaled the same way.
- **Steering recovers slowly, and lags the speed.** When a boost ends, speed eases back in 0.4 s, but steering stays reduced for another 0.6 s (`steerHoldAfter`), then eases back to full over 1.2 s (`steerRecover`) on a smoothstep curve. The designer found it jarring when steering snapped back with the speed; this way a freshly unboosted ship still feels heavy for a moment before handling returns, with no step in the controls. A new boost during recovery cuts steering again from wherever it is.
- **Double-tap detection** is kept apart from steering. Each tap must be shorter than 250 ms and move less than 14 px, and the second press must come within 330 ms of the first release and within 70 px of it. A drag never counts as a tap, so steering can't trigger a boost by accident. The tap that starts a run can't pair with a follow-up tap (no boost in the first 0.4 s), and you can't re-trigger a boost while one is running. There's no cooldown: the limit is that a boost commits you to a line.
- **Effects, all in the world:**
  - **Ignition:** a white-hot burst from the engines, a kick of camera shake, and a short vibration on Android.
  - **Engine and flame:** the engine glow grows, flickers and turns white-violet. The trail becomes a denser, hotter nitro flame.
  - **Speed lines:** thin streaks of light hang in the air along the flight path and rush past. They're kept at least 3.5 units off the flight path; streaks right beside the camera turned into huge white slashes.
  - **Camera:** the field of view kicks out by 10° (it opens fast and closes slowly), and the colour fringing at the screen edges strengthens. The camera also lags a little further behind at the higher speed, which reads as being pulled back.
- **Boost pads:** violet panels with chevrons streaming forward, set into the tunnel wall (`src/boostpads.ts`). Fly close over one and the boost **fires automatically**; if you're already boosting, it's **extended by another wall spacing**, so pads can chain. Each pad fires once, then flashes and dims.
  - **Trigger:** the ship's centre must be within 3.2 units of the tunnel wall (`triggerDistance`), inside the pad's length, and over its arc plus a 0.8-unit side margin. The ship's own collision radius is 0.26, so there's a band of about 3 units between "close enough to trigger" and "touching the wall". Flying past a pad in the middle of the tunnel does nothing.
  - **Why violet:** it's the colour of the boost flame, so the pad reads as "boost" at a glance. It's also distinct from every zone colour (cyan, magenta, amber, green tunnel lights; orange, mint, blue, red gap rims). The panel stays mostly below the bloom threshold, so it looks violet rather than blown out to white. A violet point light near the next live pad tints the ship and walls as you pass.
  - **Placement:** from the 4th wall on, with a 40% chance per stretch between walls (`pads` in `src/config.ts`). The pad sits in the middle of the stretch, on the side of the tunnel facing the next wall's gap, with some random spread. That way a line over the pad can carry you on toward the opening, but you have to fly near the wall to take it.
  - **Risk/reward:** taking a pad means flying close to the tunnel wall, then arriving at the next wall at boost speed with reduced steering. It's an optional line for advanced players, the same idea as the manual boost.
- **Boosting through a gap scores double** (`gapPoints`: 2 instead of 1), the reward for committing to a line at speed. It counts while the boost is running, or still at least half on as it winds down.
  - The score bump turns violet and bigger, and the pass burst is violet and denser, so a double reads in the world as well as on the counter.
  - **Speed and zone colour are driven by gaps passed, not points.** Otherwise double points would also speed the game up and skip colour zones.
- Desktop testing: Shift or B boosts.

## Level

- **Tunnel:** a single open cylinder that snaps forward in whole texture periods, so it looks endless with one draw call and never needs rebuilding.
- **Walls:** two kinds. A disc with a round hole, and a Flappy-style **slot** (a band across the tunnel at a random angle). After ring 8, some slots **spin**. Walls are pooled and their geometry is rebuilt only when one is recycled, never per frame.
- **Gaps are always reachable:** how far the next gap can be from the previous one is capped by the spacing between them (`maxJump`).
- **Bonus gaps:** every wall has a second, much smaller round hole with a shimmering **gold** ring, somewhere on its solid part.
  - **Reward:** flying through it scores **10 points** (`bonusPoints`) instead of 1, and **triggers the boost automatically**, or extends one already running by a wall spacing, like a boost pad. Boosting doubles it too, so a bonus gap taken while boosting is worth 20. You can chain bonus gaps for a long, high-scoring boost.
  - **Size:** about a third of the main gap's radius, kept between 1.0 and 1.7 (`bonusScale`, `bonusMinR`, `bonusMaxR`). It shrinks as the main gaps do. With the ship's 0.26 collision radius, the margin for error is small on purpose.
  - **Placement:** at least 1.5 units of solid wall from the main gap (`bonusClearance`) and clear of the tunnel wall. On spinning slots it turns with the wall.
  - **Why gold:** it reads as "treasure" and isn't any zone colour or the boost's violet. The ring flashes white and goes dark once taken.
  - **Everything knows about it:** it's one more opening in the shared gap test, so collisions, the shadow's clipping, the rim warning's prediction and the bow-wave dust all treat it as open.
- **Difficulty** comes from three things that tighten with every ring: speed (`speedPerRing`), spacing between walls, and gap size.
- **Zones:** the accent palette changes every 10 rings, giving a sense of progress at no cost.

## Scale

The user asked for a bigger world and a smaller ship ("like Stardew Valley"). We read that as **a tiny ship in a vast space**, but what the reference meant is still an open question. The changes:

- **World:** tunnel radius 6 → 16, with 32 hull panels around instead of 12. Small panels on a big surface make the size readable.
- **Later doubled again** at the designer's request: radius 16 → 32, with 64 panels around, so each panel stays the same size. Boost pads keep the same physical width, and the tunnel dust count was raised for the bigger cross-section.
  - **Gaps, the bonus gap and the ship are unchanged**, so each wall is now a much bigger surface with a relatively smaller opening, and gaps can sit up to about 25 units off centre.
  - Consecutive gaps are still capped at 30% of the wall spacing apart, so the next one stays reachable with the heavier steering.
- **Ship:** 60% of its former size, with its collision radius scaled to match. The camera sits a little further back, so the ship appears about half its former size on screen.
- **Retuned for the scale:** speed (30 → 56, later raised to 55 → 104; see Controls), wall spacing, gap sizes, fog, light ranges, and particle sizes.

## Camera

- **The ship is always at the centre of the screen** (the designer's call). The camera aims along the line from itself through the ship, recomputed every frame from the camera's smoothed position, so the ship never drifts off centre while the camera eases around. In testing it stayed within 1 px of centre in both modes and both control schemes, even while weaving hard. Steering therefore shows as the world moving around a fixed ship, not the ship moving across the screen.
- **Tunnel:** a chase camera that follows the ship sideways only partly (`follow` 0.85), pulled toward the tunnel axis, and clamped inside the tunnel. Because of the centring, this now shows up as a slightly angled view when the ship is near the wall, rather than the ship sitting off-centre. It rolls slightly with the heading (or with the ship, in roll + pitch).
- **Field of view widens with speed** to sell the acceleration.
- **Crash:** camera shake, slow motion (time scale 0.35, easing back), and chromatic aberration.
- **Free flight:** a plain chase camera behind and above the ship's heading.

## Lighting and effects

- **Bloom does most of the "good lighting" work.** It was tuned down (strength 0.6, threshold 0.85) after the first screenshots were washed out.
- **Ship light:** a point light carried by the ship and placed about 9 units *ahead* of it. Close behind the hull, it blew the small ship out into a white blob. Ahead, it lights the walls you're about to reach.
  - **It dims as a wall approaches** (`Ship.dimForWall`), so the lit pool on the wall keeps a steady brightness. At full strength a few units from the wall it flared to white, and bloom washed out the ship's shadow exactly where the player is looking. Now the shadow sits as a dark shape inside a softly lit pool, the classic spotlight-and-shadow contrast.
- **Gap light:** a light in the next gap, coloured like its rim, so the walls ahead glow around the target.
- **Blast light:** a short-lived light for explosions.
- **Image-based environment:** a faint one (RoomEnvironment) so metal has some reflections.
- **Particles:** one additive point-sprite ring buffer, simulated on the CPU, one draw call. Used for the engine trail (spawned along the path travelled each frame so it has no gaps at speed), wing-tip contrails, a burst when you pass a gap, and the explosion.
- **Speed dust:** dim motes in the tunnel that the ship flies past.
- **Engine and trail brightness:** kept low enough that the small ship isn't swallowed by its own glow.
- **HI/LO quality toggle:** LO turns bloom off and caps the pixel ratio at 1.

## Readability

### Walls fade after you pass them

The camera is about 6 units behind the ship, so a wall the ship has just passed fills the screen and hides the next one.

- Each wall **fades out only once the ship has fully cleared its back face**. Nothing fades while you're still lining up.
- The fade takes 3.4 units of travel (`fadeDistance`), which is less than the camera distance, so the wall is gone before the camera reaches it.
- Each wall has its own materials. They stay in the transparent pass so fading never triggers a shader rebuild, and they stop writing depth while fading.

### Flight aids: judging depth from behind

**Problem:** from a chase camera it's hard to tell whether the ship will thread the gap or clip the wall. A crash you couldn't read feels unfair.

**Key idea:** what matters isn't where the ship is now but **where it will cross the next wall if it holds its heading**. Between drags it flies in a straight line, so that point can be computed exactly.
- One prediction (`predict()` in `src/aids.ts`) feeds every cue.
- It uses the heading the player is steering *to* (the target), so the cues react instantly to a drag.
- It reuses the collision test (`Obstacle.fits()` with the same bevel margin), so **a cue can never disagree with the actual collision**. In testing, crashes landed within 0.07 units of the predicted point.
- For spinning slots it tests the angle the slot will have when the ship arrives.

**Options considered:**

| Option | Verdict |
|---|---|
| Real shadow from a light (Mario style) | Shadow maps are costly on mobile, so the shadow is a fake decal. It was first cast **along the flight path**, which looked unnatural. It's now cast **perpendicular to the wall**, like a real shadow from a light straight down the tunnel. |
| Reflection of the ship in the wall | Needs a second render of the scene. A mirror image shows distance but not where you'll pass relative to the gap. Rejected. |
| Ship headlight (spotlight pool) | A soft pool alone is hard to read precisely at speed. The ship light now does part of this job: it keeps a steady pool on the approaching wall, with the shadow inside it. |
| Aim line from the nose | Exact and cheap, but feels gamey. Not built. |
| **Projected shadow** | **Built**, then split into an in-world shadow and interface markers. |
| **Rim warning** | **Built.** |
| **Forgiving hitbox** | **Built.** |

**What was built.** Each aid can be switched on and off in the **Aids** panel, and the choice is saved per browser. The panel groups them by kind, because the designer wanted to compare world cues against interface cues (see Guiding principles).

| Group | Aid | Default |
|---|---|---|
| In world | Shadow on wall | On |
| In world | Rim warning | On |
| In world | Electric arcs | Off |
| In world | Headlight | Off |
| In world | Wall heat glow | Off |
| In world | Bow-wave dust | Off |
| Interface | Target markers | **Off** |
| Rules | Forgiving hitbox | On |

1. **Shadow on wall (in world).**
   - The ship's shadow on the next wall, **cast perpendicular to the wall**, as if lit from straight down the tunnel behind the ship. It sits at the ship's current x/y on the wall's face.
   - **Why perpendicular, not along the heading:** the first version projected the shadow from the ship's nose along its heading, so it showed where the ship *would* hit. That looked unnatural: when turning, the shadow ran ahead of the ship and slid around independently of it, which no real shadow does. A perpendicular shadow behaves like a real one. It's always directly "under" the ship from the wall's point of view, and as the ship closes in, ship and shadow converge on the impact point. It still warns of the approaching wall, through the growing darkness and the clipping below. Looking ahead at the predicted impact point is left to the rim warning.
   - It's plain dark, with no UI colour.
   - **It's clipped by the gap, like a real shadow.** A shader discards the shadow wherever the wall has a hole, using the same gap shape as the collision test. So the shadow is on the wall while the ship is lined up with solid wall and gone while it's lined up with the gap. **When the ship overlaps the rim, the shadow is cut by the hole's edge**, so near-misses read without any UI.
   - **When it appears is a setting:** a slider under "Shadow on wall" in the Aids panel sets the distance from the wall at which the shadow starts to appear (4 to 60 units, default 20, saved per browser). It reaches full strength at half that distance. It's measured as distance, not time, so the shadow always appears at the same closeness to the wall whatever the speed.
     - Why: the designer found the shadow appeared far too early. Originally it shared the other cues' 2-second fade-in, which at starting speed meant about 60 units out, long before the wall felt close. The default of 20 units is about 0.35 s at the starting speed of 55.
     - It uses the straight-line distance down the tunnel to the wall, not the predicted path.
   - **Fuzzy to sharp:** like a real penumbra, the shadow's softness depends on how far the ship is from the wall. Far away it's a wide, faint smudge; it tightens into a crisp, dark ship silhouette at the moment of contact. The designer asked for this so the shadow fades in naturally rather than as a fixed decal.
     - The softness comes from the signed distance to the ship's rear silhouette (a 7-point polygon) computed in the fragment shader. One parameter, the blur width, takes it from smudge to outline: `shadowMinSoft` + distance × `shadowSoftness`.
     - The blur spreads **outward** from a fully dark core. From behind the ship is only about 0.2 units tall, so a blur centred on the edge washed the whole shadow out to about 30% darkness and it vanished.
     - A wider shadow is lighter overall (the same darkness spread over more area), but never below 65%. Lighter versions disappeared against the half-black hazard stripes.
   - **Known limit:** cast straight down the tunnel and seen from a camera directly behind the ship, the shadow sits close to the line of sight, so up close the ship partly hides its own shadow. The camera sits slightly above the ship, which keeps most of it visible.
   - Works with the ship-light dimming described under Lighting.
2. **Rim warning (in world):** the gap's glowing rim pulses red when you're on course to hit that wall. It's part of the world, since the rim already glows.
3. **Target markers (interface, off by default):**
   - At the crossing point: the ship's true-size outline, a ring for the actual hitbox, and corner brackets that stay about 5% of the distance across so they're readable from afar.
   - Red on a hit course, cyan floating in the gap on a pass.
   - They were the first version of the "shadow". In playtesting they made the game feel like steering a cursor into a circle, which led to the guiding principle above. They're kept only for comparison.
   - Implementation notes: bracket bars are thin meshes because WebGL lines are always 1 pixel wide. Colours are moderate HDR values; brighter ones were desaturated to pink by the tone mapper.
4. **Forgiving hitbox (rule):** the collision radius shrinks to 80% (`forgivingScale`), so near-misses go the player's way. It's invisible, which fits the principle.

5. **More in-world cues to compare (off by default).** The designer asked for creative alternatives to the shadow that stay in the world. Each is its own toggle in the In world group, so they can be mixed and compared. Code: `src/worldcues.ts`.
   - **Electric arcs** (the designer's idea): lightning jumps between the ship and the **closest point on the nearest surface**. That's the next wall's face, the gap's rim when you're lined up with the gap, or the tunnel wall. It starts 14 units from a wall (`arcRange`) and 4 from the tunnel (`arcTubeRange`). Bolts get thicker, brighter and more frequent as the gap closes, and throw sparks where they land. Because they reach for the nearest edge, they're strongest exactly when you're about to clip the rim. Bolts are camera-facing ribbons with midpoint-displacement jaggedness, regenerated about 18 times a second so they flicker.
   - **Headlight:** a narrow spotlight from the nose along the heading. A fixed cone naturally gives a wide, dim pool far away and a small, bright one up close. Lined up with a gap, the beam falls through the hole and the pool vanishes, so no pool means you're clear. It's capped near the wall so it doesn't flare to white, and always in the scene at intensity 0 when off, so toggling doesn't rebuild shaders.
   - **Wall heat glow:** the wall glows cyan where the ship is lined up with it (straight down the tunnel, like the shadow): a faint wide haze far away that tightens into a white-hot spot, with ripples like a pushed force field. Clipped by the gap. It reads well against the dark stripes, where a shadow struggles.
   - **Bow-wave dust:** dust pushed ahead of the ship along its heading at nearly twice the ship's speed. It splashes on the wall where the ship would hit, or streams on through the gap. Unlike the shadow and heat glow, it shows the **heading**, not just the position, with no marker.
   - All cues drawn on a wall share one gap-clipping shader snippet (`GAP_GLSL`) and the bevelled face position, so they lie exactly on the surface the player sees.

**Timing:** the cues fade in from 2.0 s before the wall and are at full strength from 0.6 s (`fadeStart`, `fadeFull`), so walls far ahead stay uncluttered.

## Modes

- **Tunnel:** the game.
- **Free flight:** a sandbox for testing the controls, added at the user's request.
  - No tunnel and no obstacles: a nebula sky shader, a starfield, and a distant gas giant and sun to steer by.
  - A dust cloud wraps around the ship on all three axes **in the vertex shader**, so it's endless at zero CPU cost and always shows your motion.
  - A heading/pitch/speed readout and a Menu button.
- **Sky castle (test level):** an open level high in a planet's atmosphere, beside an enormous floating citadel, built to see what clouds, fog and a vast structure look like. Its own menu button, or a link ending in `#sky`. No collisions or objectives yet; flies like free flight. Code: `src/skylevel.ts`.
  - **The citadel is an original design** in the spirit of a castle in the sky, about 1.4 km across and 1.5 km tall:
    - **Structure:** a craggy inverted rock cone with hanging spikes, four terraced stone tiers with battlements, rim towers with teal conical roofs, gardens with trees and houses, a central keep of tall spires, and three waterfalls pouring off the lowest terrace into the clouds.
    - **Surroundings:** five small satellite islands, each with a lone tower.
  - **Scale through fog:** dense exponential fog in the horizon-haze colour (`0.0009`), so the far side and the tops of the spires dissolve and you only ever see part of it. The scale comes from what's hidden.
  - **Clouds:**
    - **Sea of clouds:** an animated noise shader far below, lit from the sun and fogged at the horizon.
    - **Cloud banks:** about 1,000 soft billboard puffs in clusters, sorted back to front, with sunlit tops and cooler bellies. There's a thick collar around the underside hiding where the rock ends, a veil drifting across the upper towers, banks at all heights, and small clouds on the approach to fly through. Puffs fade as the camera reaches them, so they never pop.
  - **Light:** a sky-dome shader (zenith blue to pale haze, with a sun disc), a warm directional sun and a sky/cloud bounce fill. Bloom is lowered and its threshold raised for daylight, so only the sun and highlights glow.
  - The camera's far plane extends to 12 km in this level; the tunnel keeps a short range for depth precision.
- **Menu:** Tunnel, Free flight and Sky castle buttons. Tapping anywhere else starts the tunnel, and a link ending in `#free` opens free flight directly.
- **Attract mode:** on the title screen, an autopilot flies through the gaps, so the menu shows the game being played.

## Delivery and testing

- **GitHub Pages:** a workflow builds and deploys on every push to `main` or `claude/**`.
- **Artifact:** a single-file build (JS and CSS inlined) is published as a private claude.ai Artifact as a second URL.
- **Testing:** Playwright drives headless Chromium with iPhone 13 emulation. It simulates touch drags, flies scripted courses, checks outcomes (score, crash position against prediction, fade timing, toggles that persist) and captures screenshots. The software renderer there runs at about 25 fps, so **real-device performance is still unverified**.

## Open questions

- **Steering:** is the sensitivity right on a real phone? Should the heading drift back to centre when the finger lifts?
- **Scale:** what did "like Stardew Valley" mean?
- **Sound:** none yet.
- **Performance** on a real device, especially with bloom.
- **Which in-world cues to keep:** shadow, rim warning, arcs, headlight, heat glow and bow-wave dust are all built and toggleable. Pick the combination that reads best without pulling attention off the ship. Still untried: a proximity sound (a hum that rises on a collision course).
- **Flight aids:** which combination should ship by default? This is what the toggles are for.
