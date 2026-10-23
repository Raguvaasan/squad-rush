import { randomInt, randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import { BALANCE } from '../src/game/balance.js';
import { countTicks, replay, type ReplayResult, type RunInputs } from '../src/game/replay.js';
import { TICK } from '../src/game/sim.js';
import {
  NAME_RULES,
  normalizeName,
  type Leaderboard,
  type LeaderboardEntry,
  type Profile,
  type RunReward,
  type RunSubmission,
  type RunTicket,
} from '../src/net/protocol.js';
import type { Player } from './auth.js';
import { runs, users, type RunDoc, type UserDoc } from './db.js';
import { HttpError } from './http.js';

const LEADERBOARD_SIZE = 50;
/** The run being played and the prefetched next one, plus one spare. Older unsubmitted tickets are dropped. */
export const MAX_OPEN_RUNS = 3;

/** Fetches the player's record, creating it on their first request. */
async function loadUser(db: Db, uid: string): Promise<UserDoc> {
  const user = await users(db).findOneAndUpdate(
    { _id: uid },
    {
      $setOnInsert: {
        name: `Soldier${randomInt(1000, 10000)}`,
        coins: 0,
        best: 0,
        bestAt: null,
        runs: 0,
        createdAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return user!;
}

/** Ties share a rank: one plus the number of players strictly ahead. */
const rankOf = async (db: Db, best: number): Promise<number> =>
  (await users(db).countDocuments({ best: { $gt: best } })) + 1;

async function toProfile(db: Db, user: UserDoc, player: Player): Promise<Profile> {
  return {
    name: user.name,
    coins: user.coins,
    best: user.best,
    rank: user.best > 0 ? await rankOf(db, user.best) : null,
    anonymous: player.anonymous,
  };
}

export async function getProfile(db: Db, player: Player): Promise<Profile> {
  return toProfile(db, await loadUser(db, player.uid), player);
}

export async function rename(db: Db, player: Player, body: unknown): Promise<Profile> {
  const name = normalizeName((body as { name?: unknown } | null)?.name);
  if (!name) throw new HttpError(400, NAME_RULES);
  await loadUser(db, player.uid);
  const user = await users(db).findOneAndUpdate({ _id: player.uid }, { $set: { name } }, { returnDocument: 'after' });
  return toProfile(db, user!, player);
}

export async function startRun(db: Db, player: Player): Promise<RunTicket> {
  await loadUser(db, player.uid);
  const run: RunDoc = {
    _id: randomUUID(),
    uid: player.uid,
    seed: randomInt(2 ** 32),
    startedAt: new Date(),
    finishedAt: null,
  };
  await runs(db).insertOne(run);

  // Capping open tickets stops a player from stockpiling seeds to practise offline.
  const stale = await runs(db)
    .find({ uid: player.uid, finishedAt: null })
    .sort({ startedAt: -1 })
    .skip(MAX_OPEN_RUNS)
    .project<{ _id: string }>({ _id: 1 })
    .toArray();
  if (stale.length > 0) await runs(db).deleteMany({ _id: { $in: stale.map((r) => r._id) } });

  return { runId: run._id, seed: run.seed };
}

export async function finishRun(db: Db, player: Player, body: unknown): Promise<RunReward> {
  const { runId, inputs, score: claimed } = (body ?? {}) as Partial<RunSubmission>;
  const ticks = countTicks(inputs);
  if (typeof runId !== 'string' || ticks === null || typeof claimed !== 'number') {
    throw new HttpError(400, 'Malformed run');
  }

  const run = await runs(db).findOneAndUpdate(
    { _id: runId, uid: player.uid, finishedAt: null },
    { $set: { finishedAt: new Date() } },
  );
  if (!run) throw new HttpError(409, 'This run was already submitted or has expired');

  const result = checkRun(run, inputs as RunInputs, ticks);
  if (!result.ok) {
    await runs(db).updateOne({ _id: runId }, { $set: { rejected: result.reason } });
    throw new HttpError(422, `Run rejected: ${result.reason}`);
  }
  // A mismatch means the browser and server sims disagree: a determinism bug, not cheating (that fails the replay).
  if (result.score !== claimed) console.warn(`Run ${runId}: replay scored ${result.score}, client saw ${claimed}`);
  await runs(db).updateOne({ _id: runId }, { $set: { score: result.score } });

  const coinsEarned = Math.floor(result.score / BALANCE.pointsPerCoin);
  const now = new Date();
  // A pipeline update, so bestAt moves only when best does, judged against the stored best in the same atomic step.
  const user = await users(db).findOneAndUpdate(
    { _id: player.uid },
    [
      {
        $set: {
          coins: { $add: ['$coins', coinsEarned] },
          runs: { $add: ['$runs', 1] },
          best: { $max: ['$best', result.score] },
          bestAt: { $cond: [{ $gt: [result.score, '$best'] }, now, '$bestAt'] },
        },
      },
    ],
    { returnDocument: 'after' },
  );
  if (!user) throw new HttpError(404, 'Player not found');
  return { score: result.score, coinsEarned, profile: await toProfile(db, user, player) };
}

/** The sim can't run faster than real time, so a run can't be submitted sooner after its ticket than it lasted. */
function checkRun(run: RunDoc, inputs: RunInputs, ticks: number): ReplayResult {
  const playedMs = ticks * TICK * 1000;
  // Slack for clock differences between function instances.
  if (Date.now() - run.startedAt.getTime() < playedMs * 0.95 - 2000) {
    return { ok: false, reason: 'submitted sooner than it could have been played' };
  }
  return replay(run.seed, inputs);
}

export async function getLeaderboard(db: Db, player: Player): Promise<Leaderboard> {
  const [me, top] = await Promise.all([
    getProfile(db, player),
    users(db)
      .find({ best: { $gt: 0 } })
      .sort({ best: -1, bestAt: 1 })
      .limit(LEADERBOARD_SIZE)
      .project<Pick<UserDoc, '_id' | 'name' | 'best'>>({ name: 1, best: 1 })
      .toArray(),
  ]);
  const entries: LeaderboardEntry[] = [];
  for (const [i, user] of top.entries()) {
    const tied = i > 0 && user.best === top[i - 1]!.best;
    entries.push({ rank: tied ? entries[i - 1]!.rank : i + 1, name: user.name, best: user.best, me: user._id === player.uid });
  }
  return { top: entries, me };
}
