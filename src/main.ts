import './style.css';
import { createGame, drainEvents, score, step, TICK } from './game/sim';
import type { GameState } from './game/types';
import { SteerInput } from './input';
import { GameRenderer } from './render/scene';
import { Hud } from './ui/hud';

const BEST_KEY = 'squad-rush.best';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas');

const view = new GameRenderer(canvas);
const input = new SteerInput(canvas);
const hud = new Hud();

// An idle squad stands behind the menu until the first run starts.
let game: GameState = createGame(1);
let playing = false;
let accumulator = 0;
let last = performance.now();

function resize(): void {
  view.resize(window.innerWidth, window.innerHeight);
}

function startRun(): void {
  game = createGame(crypto.getRandomValues(new Uint32Array(1))[0]!);
  input.reset();
  accumulator = 0;
  playing = true;
  hud.showPlaying();
}

function endRun(): void {
  playing = false;
  const result = score(game);
  const best = loadBest();
  if (result > best) saveBest(result);
  hud.showGameOver({ score: result, distance: Math.floor(game.z), kills: game.kills }, Math.max(best, result), result > best);
}

function frame(now: number): void {
  // Clamp so a backgrounded tab doesn't fast-forward the run when it comes back.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (playing) {
    input.update(dt);
    accumulator += dt;
    while (accumulator >= TICK && !game.over) {
      step(game, input.targetX);
      accumulator -= TICK;
    }
    for (const event of drainEvents(game)) hud.onEvent(event);
    if (game.over) endRun();
  }

  view.sync(game, now / 1000);
  view.render();
  hud.update(game, view.screenPosition(game.x, 1.2, game.z));
  requestAnimationFrame(frame);
}

// Storage can throw (private mode, blocked site data); the game must still run without it.
function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Best score just won't persist.
  }
}

window.addEventListener('resize', resize);
resize();
hud.onPlay(startRun);
hud.showMenu(loadBest());
requestAnimationFrame(frame);
