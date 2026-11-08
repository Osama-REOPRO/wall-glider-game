import type { Quality } from './renderer';

const BEST_KEY = 'wall-glider.best';
const QUALITY_KEY = 'wall-glider.quality';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode etc.): the value just isn't remembered */
  }
}

/** DOM overlay: score, best score, menu and game-over card, mode buttons, free-flight readout, quality toggle. */
export class Hud {
  private scoreEl = document.getElementById('score')!;
  private bestEl = document.getElementById('best')!;
  private readoutEl = document.getElementById('readout')!;
  private exitBtn = document.getElementById('exit') as HTMLButtonElement;
  private overlay = document.getElementById('overlay')!;
  private title = this.overlay.querySelector('h1')!;
  private sub = document.getElementById('overlay-sub')!;
  private cta = document.getElementById('overlay-cta')!;
  private qualityBtn = document.getElementById('quality') as HTMLButtonElement;
  best = Number(readStorage(BEST_KEY) ?? 0) || 0;

  onQualityChange: ((q: Quality) => void) | null = null;
  onTunnel: (() => void) | null = null;
  onFree: (() => void) | null = null;
  onExit: (() => void) | null = null;

  constructor() {
    const button = (el: HTMLElement, fn: () => void) => {
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
    };
    button(this.qualityBtn, () => {
      const q: Quality = this.qualityBtn.textContent === 'HI' ? 'low' : 'high';
      this.setQualityLabel(q);
      writeStorage(QUALITY_KEY, q);
      this.onQualityChange?.(q);
    });
    button(document.getElementById('mode-tunnel')!, () => this.onTunnel?.());
    button(document.getElementById('mode-free')!, () => this.onFree?.());
    button(this.exitBtn, () => this.onExit?.());
    this.renderBest();
  }

  savedQuality(): Quality {
    return readStorage(QUALITY_KEY) === 'low' ? 'low' : 'high';
  }

  setQualityLabel(q: Quality): void {
    this.qualityBtn.textContent = q === 'high' ? 'HI' : 'LO';
  }

  setScore(n: number, bump = false): void {
    this.scoreEl.textContent = String(n);
    if (bump) {
      this.scoreEl.classList.remove('bump');
      void this.scoreEl.offsetWidth;
      this.scoreEl.classList.add('bump');
      setTimeout(() => this.scoreEl.classList.remove('bump'), 120);
    }
  }

  private showScore(visible: boolean): void {
    this.scoreEl.style.visibility = visible ? 'visible' : 'hidden';
    this.bestEl.hidden = !visible;
  }

  showTitle(): void {
    this.title.textContent = 'WALL GLIDER';
    this.sub.textContent = 'Drag to steer. Fly through the gaps.';
    this.cta.textContent = 'Tap to start';
    this.overlay.classList.add('visible');
    this.showScore(false);
    this.setFreeFlight(false);
  }

  showGameOver(score: number): void {
    const isBest = score > this.best;
    if (isBest) {
      this.best = score;
      writeStorage(BEST_KEY, String(score));
      this.renderBest();
    }
    this.title.textContent = isBest && score > 0 ? 'NEW BEST' : 'CRASHED';
    this.sub.textContent = `Score ${score}  ·  Best ${this.best}`;
    this.cta.textContent = 'Tap to retry';
    this.overlay.classList.add('visible');
  }

  hideOverlay(): void {
    this.overlay.classList.remove('visible');
  }

  /** Tunnel run: score visible. */
  showRun(): void {
    this.hideOverlay();
    this.setFreeFlight(false);
    this.showScore(true);
  }

  /** Free flight: no score; heading readout and a way back to the menu. */
  showFreeFlight(): void {
    this.hideOverlay();
    this.showScore(false);
    this.setFreeFlight(true);
  }

  setReadout(text: string): void {
    this.readoutEl.textContent = text;
  }

  private setFreeFlight(on: boolean): void {
    this.readoutEl.hidden = !on;
    this.exitBtn.hidden = !on;
  }

  private renderBest(): void {
    this.bestEl.textContent = this.best > 0 ? `Best ${this.best}` : '';
  }
}
