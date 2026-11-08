# Wall Glider

A 3D mobile prototype. A triangular ship flies on its own down an endless tube, and you only control its heading: drag a finger to turn the nose and the ship flies that way. Fly through the gaps in the walls without touching anything.

**Free flight** (the menu button, or a link ending in `#free`) is an open-space sandbox for testing the controls. There's no tunnel and no obstacles, turning is unlimited (pitch stops short of straight up and down), and a readout shows heading, pitch and speed.

**Flight aids** (the Aids button, top right) help you judge depth from behind the ship: a shadow showing where you'll cross the next wall, a rim that pulses red when you're about to hit, and a forgiving hitbox. Each can be switched on and off.

Design decisions and the reasoning behind them are in [`docs/DESIGN.md`](docs/DESIGN.md).

Built with **Three.js + TypeScript + Vite**. It runs in any mobile browser, and all textures are generated procedurally, so there are no asset files.

## Run

```sh
npm install
npm run dev        # http://localhost:5173 (also exposed on your LAN, so a phone on the same Wi-Fi can open it)
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/
```

Desktop testing: drag with the mouse, or use the arrow keys / WASD. Space starts or restarts.

## Deploy (phone testing by URL)

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main` or `claude/**`. One-time setup in the repo settings:

1. **Settings → Pages → Source:** GitHub Actions.
2. **Settings → Environments → github-pages → Deployment branches:** allow the branches you push to. By default only the default branch may deploy.

## Code map

| File | What it does |
| --- | --- |
| `src/config.ts` | All tunable constants (speeds, steering sensitivity, hole sizes, spacing, camera). |
| `src/main.ts` | Scene setup, game loop, state machine (title, playing, dead), effects, camera. |
| `src/renderer.ts` | WebGL renderer, bloom, vignette and chromatic aberration, DPR cap, quality toggle. |
| `src/input.ts` | Drag to heading (yaw/pitch), clamped to a cone so the ship never turns back. |
| `src/ship.ts` | Ship mesh (extruded triangle with neon edges, engine glow, carried light) and flight model with banking. |
| `src/tube.ts` | One open cylinder that snaps forward in texture periods, so the tunnel is endless with one draw call. |
| `src/obstacles.ts` | Pooled walls with a circular hole or a Flappy-style slot (slots can spin). Difficulty curve, plus a light in the next gap. |
| `src/collision.ts` | Analytic collision that doesn't tunnel: radius check against the tube, slab-crossing test against each gap. |
| `src/particles.ts` | Additive GPU point sprites in a ring buffer (trail, contrails, pass bursts, explosion) and the speed dust. |
| `src/space.ts` | Free-flight scene: nebula sky shader, starfield, distant planet and sun, and a dust cloud that wraps around the ship on the GPU. |
| `src/aids.ts` | Flight aids: predicts where the ship will cross the next wall (same test as the collision check), and draws the projected shadow. |
| `src/textures.ts` | Canvas-generated hull panels, normal maps (Sobel from height), emissive light strips, hazard stripes. |
| `src/hud.ts` | Score, best score (localStorage), title and game-over overlay, mode buttons, Aids panel, HI/LO quality toggle. |
