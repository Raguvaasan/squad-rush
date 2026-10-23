/** Every tuning number lives here. Phase 3 moves these to Firebase Remote Config. */
export const BALANCE = {
  roadHalfWidth: 4,
  chunkLength: 60,
  forwardSpeed: 9,
  lateralSpeed: 16,

  startSquad: 10,
  maxSquad: 9999,
  maxRenderedSoldiers: 300,
  soldierSpacing: 0.28,
  maxSquadRadius: 2.6,
  /** Enemy HP one soldier absorbs on contact: a 25 HP enemy that reaches the squad kills 3 soldiers. */
  soldierHp: 10,

  fireInterval: 0.1,
  dpsPerSoldier: 10,
  maxBulletsPerVolley: 12,
  bulletSpeed: 45,
  bulletRange: 34,

  /** Enemy HP multiplier per chunk. Exponential, while gates and crates grow linearly, so every run ends. */
  difficultyGrowth: 1.15,
  bossEvery: 8,
  activateDistance: 42,

  enemies: {
    grunt: { hp: 10, speed: 2.2, steer: 1.6, radius: 0.35, score: 10 },
    brute: { hp: 60, speed: 1.6, steer: 1.0, radius: 0.6, score: 50 },
    boss: { hp: 450, speed: 1.2, steer: 0.9, radius: 1.6, score: 500 },
    crate: { hp: 40, speed: 0, steer: 0, radius: 0.5, score: 20 },
  },
  /** Added, not multiplied: compounding crates would grow as fast as the enemies and runs would never end. */
  crateDamageStep: 0.25,

  gate: {
    doubleChance: 0.08,
    /** Damage needed to raise a shootable (+/-) gate by one point, before the difficulty multiplier. */
    damagePerPoint: 25,
    maxShotGainBase: 3,
    maxShotGainPerChunk: 0.5,
  },
} as const;
