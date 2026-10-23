import type { Rng } from './rng.js';

export type EnemyKind = 'grunt' | 'brute' | 'boss' | 'crate';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  /** Walking toward the squad. Enemies wait until the squad is close, so they don't all arrive at once. */
  active: boolean;
  dead: boolean;
}

export type GateOp = 'add' | 'mul' | 'div';

export interface Gate {
  op: GateOp;
  /** add: may be negative. mul/div: the factor. */
  value: number;
  /** Shooting an add gate raises its value by one per `pointCost` damage, up to `maxShotGain`. */
  pointCost: number;
  maxShotGain: number;
  shotDamage: number;
  shotGain: number;
}

export type GateSide = 'left' | 'right';

export interface GateRow {
  id: number;
  z: number;
  left: Gate;
  right: Gate;
  taken: GateSide | null;
  /** Bumped whenever a label changes, so the renderer knows to redraw it. */
  version: number;
}

export interface Bullet {
  x: number;
  z: number;
  damage: number;
  travelled: number;
  dead: boolean;
}

export type GameEvent =
  | { type: 'gate'; label: string; good: boolean }
  | { type: 'crate' }
  | { type: 'boss' }
  | { type: 'hit'; lost: number };

export interface GameState {
  seed: number;
  tick: number;
  /** Distance travelled; also the squad's position along the road. */
  z: number;
  x: number;
  squad: number;
  peakSquad: number;
  damageMult: number;
  kills: number;
  killScore: number;
  fireTimer: number;
  bullets: Bullet[];
  enemies: Enemy[];
  gateRows: GateRow[];
  nextChunk: number;
  nextId: number;
  /** Bullet spread. Seeded, so a run replays identically from (seed, inputs). */
  rng: Rng;
  over: boolean;
  events: GameEvent[];
}
