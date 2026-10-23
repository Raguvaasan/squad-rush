import type { RunInputs } from '../game/replay.js';

/** Request and response bodies shared by the client (src/net) and the API (api/, server/). */

export interface Profile {
  name: string;
  coins: number;
  best: number;
  /** 1-based leaderboard position; null until the first ranked run. */
  rank: number | null;
  /** Signed in anonymously: progress is tied to this browser until it's linked to Google. */
  anonymous: boolean;
}

/** A server-issued seed. Only runs played on one can be ranked. */
export interface RunTicket {
  runId: string;
  seed: number;
}

export interface RunSubmission {
  runId: string;
  inputs: RunInputs;
  /** The score the client saw. The server replays the run itself and only logs a disagreement. */
  score: number;
}

export interface RunReward {
  score: number;
  coinsEarned: number;
  profile: Profile;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  best: number;
  me: boolean;
}

export interface Leaderboard {
  top: LeaderboardEntry[];
  me: Profile;
}

export const NAME_RULES = 'Use 3-16 letters, numbers, spaces, _ or -.';

/** Names are shown to everyone, so keep them short and plain. Letters from any script are fine. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{M}\p{N}_ -]{3,16}$/u.test(name) ? name : null;
}
