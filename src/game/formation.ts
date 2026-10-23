import { BALANCE } from './balance';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Radius of the squad blob. Also its hit radius, so it must stay deterministic (sqrt is exact in every engine). */
export function squadRadius(squad: number): number {
  return Math.min(Math.sqrt(Math.max(squad, 1)) * BALANCE.soldierSpacing, BALANCE.maxSquadRadius);
}

/** Offset of soldier i of n in a sunflower pattern: dense in the middle, like the crowds in Last War's ads. */
export function soldierOffset(i: number, n: number, radius: number, out: { x: number; z: number }): void {
  const r = radius * Math.sqrt((i + 0.5) / n);
  const angle = i * GOLDEN_ANGLE;
  out.x = Math.cos(angle) * r;
  out.z = Math.sin(angle) * r;
}
