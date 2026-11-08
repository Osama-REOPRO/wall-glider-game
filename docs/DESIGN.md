# Wall Glider design notes

This file records the design decisions made so far: what we chose, why, and what we turned down. Any change that makes a design decision updates this file in the same commit. Tunable numbers live in `src/config.ts`; this file explains the reasoning behind them.

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

- **Drag sets the heading, and it holds when you lift your finger.** The brief said the only control is direction. Steering is relative: heading change = finger travel × `steerSensitivity` per screen width.
- **Tunnel: the heading stays within a cone (0.55 rad) around the tunnel axis**, so the ship can never turn around and fly backwards.
- **Free flight: yaw is unlimited and pitch is capped at 1.4 rad (~80°).** Capping just short of vertical avoids the camera and the yaw/pitch maths flipping over.
- The heading is **smoothed** toward the target (`steerSmoothing`) so it doesn't jitter.
- **The ship banks into turns**, which tells the player what the ship is doing. In the tunnel it also banks with its offset from the axis; that's turned off in free flight, where yaw has no limit.
- Arrow keys/WASD and Space work on desktop for testing. Keys aimed at a focused button or checkbox are ignored by the game.
- Open question: whether the heading should drift back to centre when the finger lifts.

## Level

- **Tunnel:** a single open cylinder that snaps forward in whole texture periods, so it looks endless with one draw call and never needs rebuilding.
- **Walls:** two kinds. A disc with a round hole, and a Flappy-style **slot** (a band across the tunnel at a random angle). After ring 8, some slots **spin**. Walls are pooled and their geometry is rebuilt only when one is recycled, never per frame.
- **Gaps are always reachable:** how far the next gap can be from the previous one is capped by the spacing between them (`maxJump`).
- **Difficulty** comes from three things that tighten with every ring: speed (`speedPerRing`), spacing between walls, and gap size.
- **Zones:** the accent palette changes every 10 rings, giving a sense of progress at no cost.

## Scale

The user asked for a bigger world and a smaller ship ("like Stardew Valley"). We read that as **a tiny ship in a vast space**, but what the reference meant is still an open question. The changes:

- **World:** tunnel radius 6 → 16, with 32 hull panels around instead of 12. Small panels on a big surface make the size readable.
- **Ship:** 60% of its former size, with its collision radius scaled to match. The camera sits a little further back, so the ship appears about half its former size on screen.
- **Retuned for the scale:** speed (30 → 56), wall spacing, gap sizes, fog, light ranges, and particle sizes.

## Camera

- **Tunnel:** a chase camera that follows the ship sideways only partly (`follow` 0.85), pulled toward the tunnel axis so the way ahead stays readable. It's clamped inside the tunnel. It aims well ahead of the ship (`lookAhead`) and rolls slightly with the heading.
- **Field of view widens with speed** to sell the acceleration.
- **Crash:** camera shake, slow motion (time scale 0.35, easing back), and chromatic aberration.
- **Free flight:** a plain chase camera behind and above the ship's heading.

## Lighting and effects

- **Bloom does most of the "good lighting" work.** It was tuned down (strength 0.6, threshold 0.85) after the first screenshots were washed out.
- **Ship light:** a point light carried by the ship and placed about 9 units *ahead* of it. Close behind the hull, it blew the small ship out into a white blob. Ahead, it lights the walls you're about to reach.
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
| Real shadow from a light (Mario style) | A light's shadow only lines up with your path when you fly straight at the wall, so it's misleading when turning. Shadow maps are also costly on mobile. We used the idea but cast the shadow **along the flight path** instead. |
| Reflection of the ship in the wall | Needs a second render of the scene. A mirror image shows distance but not where you'll pass relative to the gap. Rejected. |
| Ship headlight (spotlight pool) | Natural looking, but a soft pool is hard to read precisely at speed, and it adds a light to every surface. Kept as a possible later addition for atmosphere. |
| Aim line from the nose | Exact and cheap, but feels gamey. Not built. |
| **Projected shadow** | **Built.** |
| **Rim warning** | **Built.** |
| **Forgiving hitbox** | **Built.** |

**What was built.** Each aid can be switched on and off in the **Aids** panel. All three are on by default, and the choice is saved per browser.

1. **Projected shadow:**
   - The ship's rear silhouette, at true size, drawn where it will cross the next wall, plus a ring showing the actual hitbox.
   - On course to **hit**: a dark blob shadow with red brackets, on the wall's surface.
   - On course to **pass**: cyan brackets floating in the gap.
   - The true-size silhouette is only a few pixels from far away, so **corner brackets** keep the spot readable. They stay about 5% of the distance across and close in on the silhouette as the wall nears. Brackets mark a place without exaggerating the ship's size.
   - Bracket bars are thin meshes, because WebGL draws all lines 1 pixel wide.
   - Cue colours are moderate HDR values; brighter ones were desaturated to pink by the tone mapper.
2. **Rim warning:** the gap's glowing rim pulses red when you're on course to hit that wall.
3. **Forgiving hitbox:** the collision radius shrinks to 80% (`forgivingScale`), so near-misses go the player's way.

**Timing:** the cues fade in from 2.0 s before the wall and are at full strength from 0.6 s (`fadeStart`, `fadeFull`), so walls far ahead stay uncluttered.

## Modes

- **Tunnel:** the game.
- **Free flight:** a sandbox for testing the controls, added at the user's request.
  - No tunnel and no obstacles: a nebula sky shader, a starfield, and a distant gas giant and sun to steer by.
  - A dust cloud wraps around the ship on all three axes **in the vertex shader**, so it's endless at zero CPU cost and always shows your motion.
  - A heading/pitch/speed readout and a Menu button.
- **Menu:** Tunnel and Free flight buttons. Tapping anywhere else starts the tunnel, and a link ending in `#free` opens free flight directly.
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
- **Flight aids:** which combination should ship by default? This is what the toggles are for.
