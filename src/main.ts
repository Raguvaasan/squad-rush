import './style.css';
import { InputRecorder, type RunInputs } from './game/replay';
import { createGame, drainEvents, score, step, TICK } from './game/sim';
import type { GameState } from './game/types';
import { SteerInput } from './input';
import { firebaseConfig } from './net/config';
import type { Online } from './net/online';
import type { RunTicket } from './net/protocol';
import { GameRenderer } from './render/scene';
import { AccountUi } from './ui/account';
import { Hud } from './ui/hud';

const BEST_KEY = 'squad-rush.best';
/** How long PLAY waits for a server seed before starting an unranked run. Usually the prefetched one is ready. */
const TICKET_WAIT_MS = 2000;

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas');

const view = new GameRenderer(canvas);
const input = new SteerInput(canvas);
const hud = new Hud();
const account = new AccountUi(() => hud.setBest(bestScore()));
const recorder = new InputRecorder();

// An idle squad stands behind the menu until the first run starts.
let game: GameState = createGame(1);
let playing = false;
let starting = false;
let accumulator = 0;
let last = performance.now();
let online: Online | null = null;
let ticket: RunTicket | null = null;
/** Bumped every run, so a slow upload doesn't overwrite a later run's result line. */
let runNumber = 0;

function resize(): void {
  view.resize(window.innerWidth, window.innerHeight);
}

async function startRun(): Promise<void> {
  if (playing || starting) return;
  starting = true;
  ticket = online ? await online.takeTicket(TICKET_WAIT_MS) : null;
  starting = false;
  game = createGame(ticket?.seed ?? crypto.getRandomValues(new Uint32Array(1))[0]!);
  recorder.reset();
  runNumber++;
  input.reset();
  accumulator = 0;
  playing = true;
  hud.showPlaying();
}

function endRun(): void {
  playing = false;
  const result = score(game);
  const best = bestScore();
  if (result > loadBest()) saveBest(result);
  hud.showGameOver({ score: result, distance: Math.floor(game.z), kills: game.kills }, Math.max(best, result), result > best);
  if (online) void submitRun(online, ticket, recorder.inputs, result);
}

async function submitRun(online: Online, ticket: RunTicket | null, inputs: RunInputs, result: number): Promise<void> {
  const run = runNumber;
  if (!ticket) return account.showReward({ status: 'unranked' });
  account.showReward({ status: 'saving' });
  try {
    const reward = await online.finish(ticket, inputs, result);
    account.setProfile(reward.profile);
    if (run === runNumber) account.showReward({ status: 'saved', reward });
  } catch (err) {
    if (run === runNumber) account.showReward({ status: 'failed', message: err instanceof Error ? err.message : String(err) });
  }
}

function frame(now: number): void {
  // Clamp so a backgrounded tab doesn't fast-forward the run when it comes back.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (playing) {
    input.update(dt);
    accumulator += dt;
    while (accumulator >= TICK && !game.over) {
      step(game, recorder.record(input.targetX));
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

/** The better of this device's best and the account's, which may come from another device. */
const bestScore = (): number => Math.max(loadBest(), online?.profile.best ?? 0);

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
hud.onPlay(() => void startRun());
hud.showMenu(loadBest());
requestAnimationFrame(frame);

// Without Firebase config the game is the offline Phase 1 game. With it, the menu fills in once signed in.
const config = firebaseConfig();
if (config) {
  import('./net/online')
    .then(({ Online }) => Online.connect(config))
    .then((connected) => {
      online = connected;
      account.attach(connected);
    })
    .catch((err: unknown) => console.warn('Playing offline: could not reach the game server.', err));
}
