import { BALANCE } from './balance.js';
import { generateChunk } from './chunks.js';
import { squadRadius } from './formation.js';
import { applyGate, gateLabel, isGoodGate } from './gates.js';
import { createRng } from './rng.js';
import type { Bullet, Enemy, GameEvent, GameState } from './types.js';

/** Fixed simulation step. Rendering runs at any frame rate; the game itself always advances in 1/60 s ticks. */
export const TICK = 1 / 60;

const SPAWN_AHEAD = 150;
const DESPAWN_BEHIND = 10;

export function createGame(seed: number): GameState {
  const s: GameState = {
    seed,
    tick: 0,
    z: 0,
    x: 0,
    squad: BALANCE.startSquad,
    peakSquad: BALANCE.startSquad,
    damageMult: 1,
    kills: 0,
    killScore: 0,
    fireTimer: 0,
    bullets: [],
    enemies: [],
    gateRows: [],
    nextChunk: 0,
    nextId: 1,
    rng: createRng(seed ^ 0x5bd1e995),
    over: false,
    events: [],
  };
  spawnAhead(s);
  return s;
}

export const score = (s: GameState): number => Math.floor(s.z) + s.killScore;

export function drainEvents(s: GameState): GameEvent[] {
  const events = s.events;
  s.events = [];
  return events;
}

/**
 * Advances the run by one tick. Deterministic: the only input is `targetX`, so (seed, targetX per tick)
 * replays the exact same run. Phase 2 uses that to verify leaderboard scores on the server.
 */
export function step(s: GameState, targetX: number): void {
  if (s.over) return;
  s.tick++;

  steer(s, targetX);
  const prevZ = s.z;
  s.z += BALANCE.forwardSpeed * TICK;
  spawnAhead(s);

  crossGates(s, prevZ);
  if (s.over) return;

  fire(s);
  moveBullets(s);
  moveEnemies(s);
  cleanup(s);
}

function steer(s: GameState, targetX: number): void {
  const limit = BALANCE.roadHalfWidth - squadRadius(s.squad);
  const target = clamp(targetX, -limit, limit);
  const maxMove = BALANCE.lateralSpeed * TICK;
  s.x += clamp(target - s.x, -maxMove, maxMove);
}

function spawnAhead(s: GameState): void {
  while (s.nextChunk * BALANCE.chunkLength < s.z + SPAWN_AHEAD) {
    const chunk = generateChunk(s.seed, s.nextChunk++);
    for (const e of chunk.enemies) {
      s.enemies.push({ ...e, id: s.nextId++, maxHp: e.hp, active: false, dead: false });
    }
    for (const row of chunk.gateRows) {
      s.gateRows.push({ ...row, id: s.nextId++, taken: null, version: 0 });
    }
  }
}

function crossGates(s: GameState, prevZ: number): void {
  for (const row of s.gateRows) {
    if (row.taken || row.z <= prevZ || row.z > s.z) continue;
    row.taken = s.x < 0 ? 'left' : 'right';
    row.version++;
    const gate = row[row.taken];
    s.squad = applyGate(s.squad, gate);
    s.peakSquad = Math.max(s.peakSquad, s.squad);
    s.events.push({ type: 'gate', label: gateLabel(gate), good: isGoodGate(gate) });
    if (s.squad <= 0) {
      s.over = true;
      return;
    }
  }
}

/** Every soldier shoots, but as at most 12 bullets per volley that share the squad's total damage. */
function fire(s: GameState): void {
  const radius = squadRadius(s.squad);
  s.fireTimer -= TICK;
  while (s.fireTimer <= 0) {
    s.fireTimer += BALANCE.fireInterval;
    const n = Math.min(s.squad, BALANCE.maxBulletsPerVolley);
    const damage = (s.squad * BALANCE.dpsPerSoldier * BALANCE.fireInterval * s.damageMult) / n;
    for (let i = 0; i < n; i++) {
      s.bullets.push({
        x: s.x + (s.rng() * 2 - 1) * radius * 0.9,
        z: s.z + radius * 0.5,
        damage,
        travelled: 0,
        dead: false,
      });
    }
  }
}

function moveBullets(s: GameState): void {
  const stepLength = BALANCE.bulletSpeed * TICK;
  for (const b of s.bullets) {
    const prevZ = b.z;
    b.z += stepLength;
    b.travelled += stepLength;
    if (b.travelled > BALANCE.bulletRange) {
      b.dead = true;
      continue;
    }
    if (!hitGate(s, b, prevZ)) hitEnemy(s, b, prevZ);
  }
}

/** Shootable gates soak bullets and tick their value up, until they reach their cap. */
function hitGate(s: GameState, b: Bullet, prevZ: number): boolean {
  for (const row of s.gateRows) {
    if (row.taken || row.z <= prevZ || row.z > b.z) continue;
    const gate = b.x < 0 ? row.left : row.right;
    if (gate.op !== 'add' || gate.shotGain >= gate.maxShotGain) continue;
    b.dead = true;
    gate.shotDamage += b.damage;
    const points = Math.min(Math.floor(gate.shotDamage / gate.pointCost), gate.maxShotGain);
    if (points > gate.shotGain) {
      gate.value += points - gate.shotGain;
      gate.shotGain = points;
      row.version++;
    }
    return true;
  }
  return false;
}

function hitEnemy(s: GameState, b: Bullet, prevZ: number): void {
  for (const e of s.enemies) {
    if (e.dead) continue;
    const r = BALANCE.enemies[e.kind].radius;
    if (Math.abs(b.x - e.x) > r || prevZ > e.z + r || b.z < e.z - r) continue;
    b.dead = true;
    e.hp -= b.damage;
    if (e.hp <= 0) kill(s, e);
    return;
  }
}

function kill(s: GameState, e: Enemy): void {
  e.dead = true;
  s.killScore += BALANCE.enemies[e.kind].score;
  if (e.kind === 'crate') {
    s.damageMult += BALANCE.crateDamageStep;
    s.events.push({ type: 'crate' });
  } else {
    s.kills++;
  }
}

function moveEnemies(s: GameState): void {
  const radius = squadRadius(s.squad);
  for (const e of s.enemies) {
    if (e.dead) continue;
    const spec = BALANCE.enemies[e.kind];
    if (!e.active && e.z - s.z < BALANCE.activateDistance) {
      e.active = true;
      if (e.kind === 'boss') s.events.push({ type: 'boss' });
    }
    if (e.active && spec.speed > 0) {
      e.z -= spec.speed * TICK;
      e.x += clamp(s.x - e.x, -spec.steer * TICK, spec.steer * TICK);
    }

    const dx = e.x - s.x;
    const dz = e.z - s.z;
    if (dz < -(radius + DESPAWN_BEHIND)) {
      e.dead = true;
      continue;
    }
    const reach = radius + spec.radius;
    if (dx * dx + dz * dz > reach * reach) continue;
    collide(s, e);
    if (s.over) return;
  }
}

/** An enemy that reaches the squad trades its remaining HP for soldiers. */
function collide(s: GameState, e: Enemy): void {
  e.dead = true;
  // Walking into an unbroken crate just wastes the bonus.
  if (e.kind === 'crate') return;
  const lost = Math.ceil(e.hp / BALANCE.soldierHp);
  s.squad -= lost;
  s.events.push({ type: 'hit', lost });
  if (s.squad <= 0) {
    s.squad = 0;
    s.over = true;
    return;
  }
  s.kills++;
  s.killScore += BALANCE.enemies[e.kind].score;
}

function cleanup(s: GameState): void {
  compact(s.bullets);
  compact(s.enemies);
  let w = 0;
  for (const row of s.gateRows) if (row.z > s.z - DESPAWN_BEHIND) s.gateRows[w++] = row;
  s.gateRows.length = w;
}

/** Removes dead items in place, so the hot loop doesn't allocate a new array every tick. */
function compact<T extends { dead: boolean }>(items: T[]): void {
  let w = 0;
  for (const item of items) if (!item.dead) items[w++] = item;
  items.length = w;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
