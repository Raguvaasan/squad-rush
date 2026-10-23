import { BALANCE } from './game/balance';

const KEY_SPEED = 12;
const LEFT_KEYS = new Set(['ArrowLeft', 'a', 'A']);
const RIGHT_KEYS = new Set(['ArrowRight', 'd', 'D']);

/** Turns drags and arrow keys into the one thing the sim reads: where across the road the squad should be. */
export class SteerInput {
  targetX = 0;
  private pointerId: number | null = null;
  private startPx = 0;
  private startTarget = 0;
  private readonly held = new Set<string>();

  constructor(surface: HTMLElement) {
    surface.addEventListener('pointerdown', (e) => {
      this.pointerId = e.pointerId;
      this.startPx = e.clientX;
      this.startTarget = this.targetX;
      surface.setPointerCapture(e.pointerId);
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.targetX = clampToRoad(this.startTarget + (e.clientX - this.startPx) * worldPerPixel());
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) this.pointerId = null;
    };
    surface.addEventListener('pointerup', release);
    surface.addEventListener('pointercancel', release);
    window.addEventListener('keydown', (e) => this.held.add(e.key));
    window.addEventListener('keyup', (e) => this.held.delete(e.key));
    window.addEventListener('blur', () => this.held.clear());
  }

  update(dt: number): void {
    let dir = 0;
    for (const key of this.held) {
      if (LEFT_KEYS.has(key)) dir -= 1;
      if (RIGHT_KEYS.has(key)) dir += 1;
    }
    if (dir !== 0) this.targetX = clampToRoad(this.targetX + Math.sign(dir) * KEY_SPEED * dt);
  }

  reset(): void {
    this.targetX = 0;
    this.pointerId = null;
  }
}

/** A swipe across ~70% of a phone-width screen crosses the whole road. */
const worldPerPixel = (): number => (BALANCE.roadHalfWidth * 2) / (Math.min(window.innerWidth, 640) * 0.7);

const clampToRoad = (x: number): number => Math.max(-BALANCE.roadHalfWidth, Math.min(BALANCE.roadHalfWidth, x));
