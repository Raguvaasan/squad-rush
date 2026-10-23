import { describe, expect, it } from 'vitest';
import { countTicks, InputRecorder, MAX_INPUT, MAX_RUN_TICKS, replay } from '../src/game/replay';
import { recordRun } from './record';

describe('InputRecorder', () => {
  it('quantizes steering and run-length encodes it', () => {
    const recorder = new InputRecorder();
    expect(recorder.record(0.5)).toBe(0.5);
    recorder.record(0.501);
    recorder.record(0.499);
    expect(recorder.record(-0.001)).toBe(0);
    expect(recorder.record(99)).toBe(MAX_INPUT / 64);
    expect(recorder.inputs).toEqual([32, 3, 0, 1, MAX_INPUT, 1]);
  });

  it('starts a new array on reset, leaving the old one intact', () => {
    const recorder = new InputRecorder();
    recorder.record(1);
    const previous = recorder.inputs;
    recorder.reset();
    recorder.record(2);
    expect(previous).toEqual([64, 1]);
    expect(recorder.inputs).toEqual([128, 1]);
  });
});

describe('replay', () => {
  const run = recordRun(5);

  it('reproduces a recorded run exactly, after a JSON round trip', () => {
    expect(run.ticks).toBeGreaterThan(60);
    expect(replay(5, JSON.parse(JSON.stringify(run.inputs)))).toMatchObject({ ok: true, score: run.score, ticks: run.ticks });
  });

  it("doesn't reproduce on another seed", () => {
    expect(replay(6, run.inputs).ok).toBe(false);
  });

  it('rejects inputs that stop before the squad is lost', () => {
    const short = [...run.inputs];
    short[short.length - 1]! -= 1;
    if (short.at(-1) === 0) short.splice(-2);
    expect(replay(5, short)).toEqual({ ok: false, reason: 'the run did not end' });
  });

  it('rejects inputs that carry on after the squad is lost', () => {
    const long = [...run.inputs];
    long[long.length - 1]! += 1;
    expect(replay(5, long)).toEqual({ ok: false, reason: 'inputs continue after the squad was lost' });
  });
});

describe('countTicks', () => {
  it('sums the run lengths of well-formed inputs', () => {
    expect(countTicks([0, 10, -5, 3])).toBe(13);
  });

  it.each([
    ['not an array', 'nope'],
    ['empty', []],
    ['odd length', [0, 1, 2]],
    ['fractional value', [0.5, 1]],
    ['value off the road', [MAX_INPUT + 1, 1]],
    ['zero-length run', [0, 0]],
    ['string count', [0, '3']],
    ['longer than a run can be', [0, MAX_RUN_TICKS, 1, 1]],
  ])('rejects %s', (_, value) => {
    expect(countTicks(value)).toBeNull();
  });
});
