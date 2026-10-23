import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/game/balance';
import { difficulty, generateChunk, isBossChunk } from '../src/game/chunks';
import { applyGate, gateLabel, isGoodGate } from '../src/game/gates';
import { createRng } from '../src/game/rng';
import { createGame, score, step } from '../src/game/sim';
import type { Gate, GameState, GateRow } from '../src/game/types';

const gate = (op: Gate['op'], value: number): Gate => ({
  op,
  value,
  pointCost: 1,
  maxShotGain: 0,
  shotDamage: 0,
  shotGain: 0,
});

const runUntil = (s: GameState, targetX: number, done: () => boolean, maxTicks = 10_000): void => {
  for (let i = 0; i < maxTicks && !done(); i++) step(s, targetX);
};

/** Clears the generated level so a test can place exactly what it needs. */
const emptyGame = (): GameState => {
  const s = createGame(1);
  s.enemies = [];
  s.gateRows = [];
  s.nextChunk = Number.MAX_SAFE_INTEGER;
  return s;
};

describe('rng', () => {
  it('repeats for the same seed and stays in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('chunks', () => {
  it('are deterministic per (seed, index)', () => {
    expect(generateChunk(7, 5)).toEqual(generateChunk(7, 5));
    expect(generateChunk(7, 5)).not.toEqual(generateChunk(8, 5));
  });

  it('start with an empty runway', () => {
    expect(generateChunk(7, 0)).toEqual({ index: 0, enemies: [], gateRows: [] });
  });

  it('put a boss in every boss chunk', () => {
    for (let i = 1; i <= 40; i++) {
      const bosses = generateChunk(3, i).enemies.filter((e) => e.kind === 'boss');
      expect(bosses.length).toBe(isBossChunk(i) ? 1 : 0);
    }
  });

  it('always offer at least one helpful gate', () => {
    for (let i = 1; i <= 100; i++) {
      for (const row of generateChunk(11, i).gateRows) {
        expect(isGoodGate(row.left) || isGoodGate(row.right)).toBe(true);
      }
    }
  });

  it('get harder further along', () => {
    expect(difficulty(0)).toBe(1);
    expect(difficulty(20)).toBeGreaterThan(difficulty(10));
  });
});

describe('gates', () => {
  it('apply add, multiply and divide, clamped to [0, maxSquad]', () => {
    expect(applyGate(10, gate('add', 5))).toBe(15);
    expect(applyGate(10, gate('add', -50))).toBe(0);
    expect(applyGate(10, gate('mul', 3))).toBe(30);
    expect(applyGate(11, gate('div', 2))).toBe(6);
    expect(applyGate(9000, gate('mul', 2))).toBe(BALANCE.maxSquad);
  });

  it('label themselves', () => {
    expect(gateLabel(gate('add', 5))).toBe('+5');
    expect(gateLabel(gate('add', -5))).toBe('-5');
    expect(gateLabel(gate('mul', 2))).toBe('×2');
    expect(gateLabel(gate('div', 2))).toBe('÷2');
  });
});

describe('sim', () => {
  it('replays identically from the same seed and inputs', () => {
    const play = () => {
      const s = createGame(1234);
      for (let t = 0; t < 3600 && !s.over; t++) step(s, Math.sin(t / 50) * 3);
      return { z: s.z, x: s.x, squad: s.squad, kills: s.kills, score: score(s), enemies: s.enemies.length };
    };
    expect(play()).toEqual(play());
  });

  it('applies the gate on the side the squad passes through', () => {
    const row = (z: number): GateRow => ({ id: 1, z, left: gate('mul', 2), right: gate('div', 2), taken: null, version: 0 });

    const left = emptyGame();
    left.gateRows.push(row(5));
    runUntil(left, -3, () => left.z > 5);
    expect(left.squad).toBe(BALANCE.startSquad * 2);

    const right = emptyGame();
    right.gateRows.push(row(5));
    runUntil(right, 3, () => right.z > 5);
    expect(right.squad).toBe(BALANCE.startSquad / 2);
  });

  it('lets bullets raise a negative gate', () => {
    const s = emptyGame();
    const bad: Gate = { ...gate('add', -5), maxShotGain: 8 };
    s.gateRows.push({ id: 1, z: 20, left: gate('mul', 2), right: bad, taken: null, version: 0 });
    runUntil(s, 3, () => s.z > 20);
    expect(bad.shotGain).toBe(8);
    expect(s.squad).toBe(BALANCE.startSquad + 3);
  });

  it('ends the run when an enemy overwhelms the squad', () => {
    const s = emptyGame();
    s.enemies.push({ id: 1, kind: 'brute', x: 0, z: 3, hp: 1e6, maxHp: 1e6, active: true, dead: false });
    runUntil(s, 0, () => s.over, 600);
    expect(s.over).toBe(true);
    expect(s.squad).toBe(0);
  });

  it('boosts firepower when a crate is shot open', () => {
    const s = emptyGame();
    s.enemies.push({ id: 1, kind: 'crate', x: 0, z: 25, hp: 5, maxHp: 5, active: false, dead: false });
    runUntil(s, 0, () => s.z > 20);
    expect(s.damageMult).toBe(1 + BALANCE.crateDamageStep);
  });
});

describe('balance', () => {
  /** Picks the better gate of each row; otherwise holds the centre. A stand-in for a decent player. */
  const bot = (seed: number) => {
    const s = createGame(seed);
    while (!s.over && s.tick < 200_000) {
      const next = s.gateRows.find((r) => !r.taken && r.z > s.z);
      const target = next && applyGate(s.squad, next.left) >= applyGate(s.squad, next.right) ? -3 : 3;
      step(s, next ? target : 0);
    }
    return s;
  };

  // A perfect-gate bot currently dies around chunk 36-50 (4-6 minutes). Retune if this starts failing.
  it('lets a decent player beat the first boss, but every run still ends', () => {
    const firstBossZ = BALANCE.bossEvery * BALANCE.chunkLength + 50;
    for (const s of [1, 2, 3].map(bot)) {
      expect(s.over).toBe(true);
      expect(s.z).toBeGreaterThan(firstBossZ);
      expect(s.z).toBeLessThan(80 * BALANCE.chunkLength);
    }
  }, 120_000);
});
