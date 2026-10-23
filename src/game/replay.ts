import { BALANCE } from './balance.js';
import { createGame, score, step } from './sim.js';

/**
 * Steering is recorded once per tick as an integer number of 1/64ths of a world unit. The client steps its own
 * sim with the rounded value too, so the server's replay is fed bit-identical inputs.
 */
const STEPS_PER_UNIT = 64;
export const MAX_INPUT = BALANCE.roadHalfWidth * STEPS_PER_UNIT;
/** 20 minutes. Difficulty grows exponentially, so even a perfect-gate bot only lasts 4-6. */
export const MAX_RUN_TICKS = 20 * 60 * 60;

/** Run-length encoded steering: [value, ticks, value, ticks, ...]. */
export type RunInputs = number[];

// `|| 0` turns -0 into 0, which is what the value becomes after a JSON round trip anyway.
const quantize = (x: number): number => Math.max(-MAX_INPUT, Math.min(MAX_INPUT, Math.round(x * STEPS_PER_UNIT))) || 0;
const dequantize = (q: number): number => q / STEPS_PER_UNIT;

export class InputRecorder {
  inputs: RunInputs = [];

  /** Records one tick of steering and returns the value the sim must step with. */
  record(targetX: number): number {
    const q = quantize(targetX);
    const n = this.inputs.length;
    if (n > 0 && this.inputs[n - 2] === q) this.inputs[n - 1]!++;
    else this.inputs.push(q, 1);
    return dequantize(q);
  }

  /** Starts a fresh array, so a run still being uploaded keeps its own inputs. */
  reset(): void {
    this.inputs = [];
  }
}

/** Number of ticks `value` covers if it is well-formed run inputs, otherwise null. */
export function countTicks(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0 || value.length % 2 !== 0) return null;
  let ticks = 0;
  for (let i = 0; i < value.length; i += 2) {
    const q: unknown = value[i];
    const n: unknown = value[i + 1];
    if (!Number.isInteger(q) || Math.abs(q as number) > MAX_INPUT) return null;
    if (!Number.isInteger(n) || (n as number) < 1) return null;
    ticks += n as number;
    if (ticks > MAX_RUN_TICKS) return null;
  }
  return ticks;
}

export type ReplayResult =
  | { ok: true; score: number; ticks: number; distance: number; kills: number }
  | { ok: false; reason: string };

/** Rebuilds a run from its seed and inputs. Only a run whose inputs end exactly when the squad is lost counts. */
export function replay(seed: number, inputs: RunInputs): ReplayResult {
  const s = createGame(seed);
  for (let i = 0; i < inputs.length; i += 2) {
    const x = dequantize(inputs[i]!);
    for (let n = inputs[i + 1]!; n > 0; n--) {
      if (s.over) return { ok: false, reason: 'inputs continue after the squad was lost' };
      step(s, x);
    }
  }
  if (!s.over) return { ok: false, reason: 'the run did not end' };
  return { ok: true, score: score(s), ticks: s.tick, distance: Math.floor(s.z), kills: s.kills };
}
