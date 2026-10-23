import { score } from '../game/sim';
import type { GameEvent, GameState } from '../game/types';
import type { ScreenPoint } from '../render/scene';

export interface RunResult {
  score: number;
  distance: number;
  kills: number;
}

type ToastKind = 'good' | 'bad' | 'info';

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

/** The DOM overlay: menus, score, boss bar, the squad counter and floating "+10" toasts. */
export class Hud {
  private readonly hud = byId('hud');
  private readonly scoreEl = byId('score');
  private readonly distEl = byId('dist');
  private readonly bossBar = byId('boss');
  private readonly bossFill = byId('boss-fill');
  private readonly squadLabel = byId('squad-label');
  private readonly toasts = byId('toasts');
  private readonly menu = byId('menu');
  private readonly bestEl = byId('best');
  private readonly over = byId('over');
  private readonly finalScore = byId('final-score');
  private readonly finalDist = byId('final-dist');
  private readonly finalKills = byId('final-kills');
  private readonly newBest = byId('new-best');
  private readonly playButton = byId<HTMLButtonElement>('play');
  private readonly againButton = byId<HTMLButtonElement>('again');
  private shown = { score: -1, dist: -1, squad: -1 };
  private squadPos: ScreenPoint = { x: 0, y: 0 };

  onPlay(handler: () => void): void {
    this.playButton.addEventListener('click', handler);
    this.againButton.addEventListener('click', handler);
  }

  showMenu(best: number): void {
    this.bestEl.textContent = best.toLocaleString();
    this.setScreen('menu');
    this.playButton.focus();
  }

  showPlaying(): void {
    this.shown = { score: -1, dist: -1, squad: -1 };
    this.setScreen('playing');
  }

  showGameOver(result: RunResult, best: number, isNewBest: boolean): void {
    this.finalScore.textContent = result.score.toLocaleString();
    this.finalDist.textContent = `${result.distance.toLocaleString()} m`;
    this.finalKills.textContent = result.kills.toLocaleString();
    this.bestEl.textContent = best.toLocaleString();
    this.newBest.hidden = !isNewBest;
    this.setScreen('over');
    this.againButton.focus();
  }

  update(s: GameState, squadPos: ScreenPoint): void {
    this.squadPos = squadPos;
    if (this.hud.hidden) return;

    const sc = score(s);
    if (sc !== this.shown.score) this.scoreEl.textContent = sc.toLocaleString();
    const dist = Math.floor(s.z);
    if (dist !== this.shown.dist) this.distEl.textContent = `${dist.toLocaleString()} m`;
    if (s.squad !== this.shown.squad) this.squadLabel.textContent = String(s.squad);
    this.shown = { score: sc, dist, squad: s.squad };
    this.squadLabel.style.transform = `translate(${squadPos.x}px, ${squadPos.y}px) translate(-50%, -100%)`;

    const boss = s.enemies.find((e) => e.kind === 'boss' && e.active);
    this.bossBar.hidden = !boss;
    if (boss) this.bossFill.style.transform = `scaleX(${Math.max(0, boss.hp / boss.maxHp)})`;
  }

  onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'gate':
        this.toast(e.label, e.good ? 'good' : 'bad');
        break;
      case 'crate':
        this.toast('Firepower up!', 'info');
        break;
      case 'boss':
        this.toast('BOSS!', 'bad');
        break;
      case 'hit':
        // Single grunts cost one soldier each; only call out the big hits.
        if (e.lost >= 5) this.toast(`-${e.lost}`, 'bad');
        break;
    }
  }

  private setScreen(screen: 'menu' | 'playing' | 'over'): void {
    this.menu.hidden = screen !== 'menu';
    this.over.hidden = screen !== 'over';
    this.hud.hidden = screen !== 'playing';
    this.squadLabel.hidden = screen !== 'playing';
    if (screen !== 'playing') this.bossBar.hidden = true;
  }

  private toast(text: string, kind: ToastKind): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    el.style.left = `${this.squadPos.x}px`;
    el.style.top = `${this.squadPos.y - 64}px`;
    el.addEventListener('animationend', () => el.remove());
    this.toasts.append(el);
  }
}
