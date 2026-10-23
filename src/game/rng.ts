export type Rng = () => number;

/** mulberry32: tiny and fast, and the same seed gives the same sequence on every device and on the server. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent seed for (seed, index), so chunk N can be generated without generating chunks 0..N-1. */
export function hashSeed(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export const range = (rng: Rng, min: number, max: number): number => min + rng() * (max - min);

export const intRange = (rng: Rng, min: number, max: number): number => Math.floor(range(rng, min, max + 1));
