import * as THREE from 'three';

/**
 * Procedural textures, generated once at startup on 2D canvases.
 * There are no image assets: everything is drawn here, so the build stays tiny.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Deterministic PRNG so the textures look the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a tangent-space normal map from a grayscale height canvas (Sobel filter). */
function normalFromHeight(src: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const hd = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [out, octx] = canvas(w, h);
  const img = octx.createImageData(w, h);
  const H = (x: number, y: number) => hd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy =
        H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function toTexture(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface MaterialMaps {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

/**
 * Tube wall: a 2×2 grid of hull panels with recessed seams, rivets and grime.
 * Light strips run along one seam column and one seam row, so a lit grid streams past the ship.
 * U runs around the tube, V runs along it.
 */
export function createTubeMaps(): MaterialMaps {
  const W = 256;
  const H = 512;
  const rnd = mulberry32(7);
  const [albedo, a] = canvas(W, H);
  const [height, hctx] = canvas(W, H);
  const [emissive, e] = canvas(W, H);
  const [rough, r] = canvas(W, H);

  a.fillStyle = '#2a3140';
  a.fillRect(0, 0, W, H);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, W, H);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  r.fillStyle = '#7a7a7a';
  r.fillRect(0, 0, W, H);

  const pw = W / 2;
  const ph = H / 2;
  const seam = 6;
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x0 = px * pw + seam;
      const y0 = py * ph + seam;
      const w = pw - seam * 2;
      const h = ph - seam * 2;
      // Panel tone variation.
      const tone = 40 + Math.floor(rnd() * 18);
      a.fillStyle = `rgb(${tone - 4},${tone + 2},${tone + 14})`;
      a.fillRect(x0, y0, w, h);
      // Raised panel with a bevelled edge in the height map.
      const grad = hctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
      grad.addColorStop(0, '#d0d0d0');
      grad.addColorStop(1, '#b8b8b8');
      hctx.fillStyle = grad;
      hctx.fillRect(x0, y0, w, h);
      // Inset sub-plate on alternating panels.
      if ((px + py) % 2 === 0) {
        hctx.fillStyle = '#9a9a9a';
        hctx.fillRect(x0 + 18, y0 + 24, w - 36, h - 48);
        a.fillStyle = `rgba(255,255,255,0.04)`;
        a.fillRect(x0 + 18, y0 + 24, w - 36, h - 48);
        r.fillStyle = '#5a5a5a';
        r.fillRect(x0 + 18, y0 + 24, w - 36, h - 48);
      } else {
        // Vent slats.
        for (let i = 0; i < 9; i++) {
          const yy = y0 + 40 + i * 18;
          hctx.fillStyle = '#6a6a6a';
          hctx.fillRect(x0 + 28, yy, w - 56, 7);
          a.fillStyle = 'rgba(0,0,0,0.35)';
          a.fillRect(x0 + 28, yy, w - 56, 7);
        }
      }
      // Rivets.
      for (const [rx, ry] of [
        [x0 + 8, y0 + 8],
        [x0 + w - 8, y0 + 8],
        [x0 + 8, y0 + h - 8],
        [x0 + w - 8, y0 + h - 8],
      ]) {
        hctx.fillStyle = '#ffffff';
        hctx.beginPath();
        hctx.arc(rx, ry, 3, 0, Math.PI * 2);
        hctx.fill();
        a.fillStyle = 'rgba(180,200,230,0.35)';
        a.beginPath();
        a.arc(rx, ry, 2.5, 0, Math.PI * 2);
        a.fill();
      }
    }
  }

  // Grime speckles.
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const s = rnd() * 2.2;
    a.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.05)';
    a.fillRect(x, y, s, s);
  }
  // Long scratches running along the tube.
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    a.strokeStyle = 'rgba(200,220,255,0.06)';
    a.lineWidth = 1;
    a.beginPath();
    a.moveTo(x, y);
    a.lineTo(x + (rnd() - 0.5) * 6, y + 20 + rnd() * 60);
    a.stroke();
  }

  // Emissive light strips inside one vertical seam and one horizontal seam.
  e.fillStyle = '#ffffff';
  e.fillRect(0, 0, 3, H);
  e.fillRect(0, 0, W, 3);
  // Small status lights on alternate panels.
  e.fillStyle = '#9fdfff';
  e.fillRect(pw + seam + 22, seam + 14, 26, 4);
  e.fillRect(seam + 22, ph + seam + 14, 26, 4);
  a.fillStyle = '#7fb8d8';
  a.fillRect(0, 0, 3, H);
  a.fillRect(0, 0, W, 3);

  return {
    map: toTexture(albedo, true),
    normalMap: toTexture(normalFromHeight(height, 2.2), false),
    emissiveMap: toTexture(emissive, true),
    roughnessMap: toTexture(rough, false),
  };
}

/** Obstacle face: dark plating with diagonal hazard stripes near the edges. */
export function createObstacleMaps(): Pick<MaterialMaps, 'map' | 'normalMap'> {
  const S = 256;
  const rnd = mulberry32(42);
  const [albedo, a] = canvas(S, S);
  const [height, h] = canvas(S, S);

  a.fillStyle = '#1b1e26';
  a.fillRect(0, 0, S, S);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, S, S);

  // Diagonal hazard stripes, tiling seamlessly.
  const stripe = 32;
  a.save();
  for (let i = -S; i < S * 2; i += stripe * 2) {
    a.fillStyle = '#d98a1f';
    a.beginPath();
    a.moveTo(i, 0);
    a.lineTo(i + stripe, 0);
    a.lineTo(i + stripe - S, S);
    a.lineTo(i - S, S);
    a.closePath();
    a.fill();
    h.fillStyle = '#9a9a9a';
    h.beginPath();
    h.moveTo(i, 0);
    h.lineTo(i + stripe, 0);
    h.lineTo(i + stripe - S, S);
    h.lineTo(i - S, S);
    h.closePath();
    h.fill();
  }
  a.restore();

  // Wear and chips.
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const s = 1 + rnd() * 3;
    a.fillStyle = rnd() < 0.7 ? 'rgba(10,10,14,0.45)' : 'rgba(255,230,180,0.08)';
    a.fillRect(x, y, s, s);
  }
  // Panel seam grid.
  h.fillStyle = '#404040';
  h.fillRect(0, 0, S, 3);
  h.fillRect(0, 0, 3, S);
  a.fillStyle = 'rgba(0,0,0,0.5)';
  a.fillRect(0, 0, S, 3);
  a.fillRect(0, 0, 3, S);

  return {
    map: toTexture(albedo, true),
    normalMap: toTexture(normalFromHeight(height, 1.5), false),
  };
}

/** Soft radial gradient used for glow sprites. */
export function createGlowTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
