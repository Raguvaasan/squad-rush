import { BALANCE } from './balance';
import { createRng, hashSeed, intRange, range, type Rng } from './rng';
import type { EnemyKind, Gate, GateOp } from './types';

export interface SpawnEnemy {
  kind: EnemyKind;
  x: number;
  z: number;
  hp: number;
}

export interface SpawnGateRow {
  z: number;
  left: Gate;
  right: Gate;
}

export interface Chunk {
  index: number;
  enemies: SpawnEnemy[];
  gateRows: SpawnGateRow[];
}

export const isBossChunk = (index: number): boolean => index > 0 && index % BALANCE.bossEvery === 0;

/** Enemy strength multiplier for a chunk. A loop rather than `**`, so browser and server replays agree to the bit. */
export function difficulty(index: number): number {
  let d = 1;
  for (let i = 0; i < index; i++) d *= BALANCE.difficultyGrowth;
  return d;
}

/** Pure: the same (seed, index) always builds the same chunk, so the server can rebuild any run from its seed. */
export function generateChunk(seed: number, index: number): Chunk {
  const chunk: Chunk = { index, enemies: [], gateRows: [] };
  // Chunk 0 is an empty runway to get a feel for steering.
  if (index === 0) return chunk;

  const rng = createRng(hashSeed(seed, index));
  const start = index * BALANCE.chunkLength;
  const d = difficulty(index);
  const lane = BALANCE.roadHalfWidth - 0.5;

  if (isBossChunk(index)) {
    chunk.gateRows.push(gateRow(rng, index, start + 12));
    chunk.enemies.push({ kind: 'boss', x: 0, z: start + 45, hp: BALANCE.enemies.boss.hp * d });
    return chunk;
  }

  chunk.gateRows.push(gateRow(rng, index, start + 15));

  if (index >= 2 && rng() < 0.35) {
    chunk.enemies.push({ kind: 'crate', x: range(rng, -2.5, 2.5), z: start + 28, hp: BALANCE.enemies.crate.hp * d });
  }

  const count = Math.min(4 + Math.floor(index * 0.9) + intRange(rng, 0, 3), 40);
  for (let i = 0; i < count; i++) {
    const kind: EnemyKind = index >= 4 && rng() < 0.12 ? 'brute' : 'grunt';
    chunk.enemies.push({
      kind,
      x: range(rng, -lane, lane),
      z: start + 40 + range(rng, 0, 10),
      hp: BALANCE.enemies[kind].hp * d,
    });
  }
  return chunk;
}

function gateRow(rng: Rng, index: number, z: number): SpawnGateRow {
  const good = goodGate(rng, index);
  // Usually a real choice; sometimes both sides help and the player picks the bigger one.
  // The first row is always friendly, so a new player isn't wiped out before learning to steer.
  const other = index === 1 || rng() < 0.25 ? goodGate(rng, index) : badGate(rng, index);
  return rng() < 0.5 ? { z, left: good, right: other } : { z, left: other, right: good };
}

function goodGate(rng: Rng, index: number): Gate {
  if (rng() < BALANCE.gate.doubleChance) return makeGate('mul', 2, index);
  return makeGate('add', 4 + intRange(rng, 0, 4) + index * 2, index);
}

function badGate(rng: Rng, index: number): Gate {
  if (index >= 3 && rng() < 0.2) return makeGate('div', 2, index);
  return makeGate('add', -(2 + intRange(rng, 0, 3) + index * 2), index);
}

function makeGate(op: GateOp, value: number, index: number): Gate {
  const shootable = op === 'add';
  return {
    op,
    value,
    pointCost: BALANCE.gate.damagePerPoint * difficulty(index),
    maxShotGain: shootable ? Math.round(BALANCE.gate.maxShotGainBase + index * BALANCE.gate.maxShotGainPerChunk) : 0,
    shotDamage: 0,
    shotGain: 0,
  };
}
