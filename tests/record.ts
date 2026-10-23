import { applyGate } from '../src/game/gates';
import { InputRecorder, MAX_RUN_TICKS, type RunInputs } from '../src/game/replay';
import { createGame, score, step } from '../src/game/sim';

export interface RecordedRun {
  inputs: RunInputs;
  score: number;
  ticks: number;
}

/** Plays and records a short run, the way main.ts does: the sim steps with whatever the recorder hands back. */
export function recordRun(seed: number): RecordedRun {
  const s = createGame(seed);
  const recorder = new InputRecorder();
  while (!s.over && s.tick < MAX_RUN_TICKS) {
    const next = s.gateRows.find((r) => !r.taken && r.z > s.z);
    // Take the worse gate so the run ends within seconds; the wobble gives the recorder many distinct values.
    const worse = next && applyGate(s.squad, next.left) < applyGate(s.squad, next.right) ? -3 : 3;
    step(s, recorder.record(worse + Math.sin(s.tick / 7) * 0.8));
  }
  return { inputs: recorder.inputs, score: score(s), ticks: s.tick };
}
