import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import type { Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../src/game/balance';
import { TICK } from '../src/game/sim';
import { requirePlayer, verifyIdToken, type Player } from '../server/auth';
import { closeDb, getDb, runs, users } from '../server/db';
import { HttpError } from '../server/http';
import { finishRun, getLeaderboard, getProfile, MAX_OPEN_RUNS, rename, startRun } from '../server/players';
import { recordRun } from './record';

const alice: Player = { uid: 'alice', anonymous: true };
const bob: Player = { uid: 'bob', anonymous: false };

const httpStatus = (status: number) => expect.objectContaining({ status }) as HttpError;

describe('players', () => {
  let mongo: MongoMemoryServer;
  let db: Db;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.MONGODB_DB = 'squad-rush-test';
    db = await getDb();
  }, 120_000);

  afterAll(async () => {
    await closeDb();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await Promise.all([users(db).deleteMany({}), runs(db).deleteMany({})]);
  });

  /** Moves a ticket's start back far enough that the run could have been played since. */
  const backdate = (runId: string, ticks: number) =>
    runs(db).updateOne({ _id: runId }, { $set: { startedAt: new Date(Date.now() - ticks * TICK * 1000) } });

  /** Starts a run, plays it and, unless told not to, waits out its length. */
  async function playRun(player: Player, { wait = true } = {}) {
    const ticket = await startRun(db, player);
    const run = recordRun(ticket.seed);
    if (wait) await backdate(ticket.runId, run.ticks);
    return { submission: { runId: ticket.runId, inputs: run.inputs, score: run.score }, run };
  }

  it('creates a player on their first request', async () => {
    expect(await getProfile(db, alice)).toEqual({
      name: expect.stringMatching(/^Soldier\d{4}$/),
      coins: 0,
      best: 0,
      rank: null,
      anonymous: true,
    });
  });

  it('pays out a verified run exactly once', async () => {
    const { submission, run } = await playRun(alice);
    const coins = Math.floor(run.score / BALANCE.pointsPerCoin);

    const reward = await finishRun(db, alice, submission);
    expect(reward).toEqual({
      score: run.score,
      coinsEarned: coins,
      profile: expect.objectContaining({ coins, best: run.score, rank: 1 }),
    });
    await expect(finishRun(db, alice, submission)).rejects.toEqual(httpStatus(409));
    expect((await getProfile(db, alice)).coins).toBe(coins);
  });

  it('rejects a run submitted sooner than it could have been played, and spends the ticket', async () => {
    const { submission } = await playRun(alice, { wait: false });
    await expect(finishRun(db, alice, submission)).rejects.toEqual(httpStatus(422));
    expect(await runs(db).findOne({ _id: submission.runId })).toMatchObject({ rejected: expect.stringContaining('sooner') });
    await backdate(submission.runId, 1e6);
    await expect(finishRun(db, alice, submission)).rejects.toEqual(httpStatus(409));
  });

  it('rejects inputs that replay differently', async () => {
    const { submission } = await playRun(alice);
    submission.inputs[submission.inputs.length - 1]! += 1;
    await expect(finishRun(db, alice, submission)).rejects.toEqual(httpStatus(422));
    expect((await getProfile(db, alice)).coins).toBe(0);
  });

  it("won't take another player's ticket", async () => {
    const { submission } = await playRun(alice);
    await getProfile(db, bob);
    await expect(finishRun(db, bob, submission)).rejects.toEqual(httpStatus(409));
  });

  it(`keeps only the newest ${MAX_OPEN_RUNS} open tickets`, async () => {
    const first = await startRun(db, alice);
    for (let i = 0; i < MAX_OPEN_RUNS; i++) await startRun(db, alice);
    expect(await runs(db).countDocuments({ uid: 'alice', finishedAt: null })).toBe(MAX_OPEN_RUNS);
    expect(await runs(db).findOne({ _id: first.runId })).toBeNull();
  });

  it.each([
    ['no body', null],
    ['no inputs', { runId: 'x', score: 0 }],
    ['bad inputs', { runId: 'x', inputs: [1], score: 0 }],
    ['no score', { runId: 'x', inputs: [0, 1] }],
  ])('rejects a malformed submission: %s', async (_, body) => {
    await expect(finishRun(db, alice, body)).rejects.toEqual(httpStatus(400));
  });

  it('never lowers a best score, but still pays coins', async () => {
    await getProfile(db, alice);
    const bestAt = new Date('2026-01-01');
    await users(db).updateOne({ _id: 'alice' }, { $set: { best: 1e9, bestAt } });
    const { submission, run } = await playRun(alice);
    await finishRun(db, alice, submission);
    expect(await users(db).findOne({ _id: 'alice' })).toMatchObject({
      best: 1e9,
      bestAt,
      coins: Math.floor(run.score / BALANCE.pointsPerCoin),
      runs: 1,
    });
  });

  it('validates and tidies names', async () => {
    await expect(rename(db, alice, { name: 'ab' })).rejects.toEqual(httpStatus(400));
    await expect(rename(db, alice, { name: '<script>' })).rejects.toEqual(httpStatus(400));
    expect((await rename(db, alice, { name: '  Captain   Ragu ' })).name).toBe('Captain Ragu');
    expect((await rename(db, alice, { name: 'ராகு' })).name).toBe('ராகு');
  });

  it('ranks the leaderboard best-first, ties share a rank, the earlier score listed first', async () => {
    const at = (day: number) => new Date(2026, 0, day);
    await users(db).insertMany([
      { _id: 'a', name: 'A', coins: 0, best: 500, bestAt: at(1), runs: 1, createdAt: at(1) },
      { _id: 'b', name: 'B', coins: 0, best: 900, bestAt: at(1), runs: 1, createdAt: at(1) },
      { _id: 'c', name: 'C', coins: 0, best: 500, bestAt: at(2), runs: 1, createdAt: at(1) },
      { _id: 'd', name: 'D', coins: 0, best: 100, bestAt: at(1), runs: 1, createdAt: at(1) },
      { _id: 'e', name: 'E', coins: 0, best: 0, bestAt: null, runs: 0, createdAt: at(1) },
    ]);
    const board = await getLeaderboard(db, { uid: 'c', anonymous: false });
    expect(board.top.map(({ rank, name, me }) => [rank, name, me])).toEqual([
      [1, 'B', false],
      [2, 'A', false],
      [2, 'C', true],
      [4, 'D', false],
    ]);
    expect(board.me).toMatchObject({ name: 'C', rank: 2 });
  });
});

describe('verifyIdToken', () => {
  const projectId = 'squad-rush-test';
  let keys: JWTVerifyGetKey;
  let privateKey: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
  });

  const now = () => Math.floor(Date.now() / 1000);
  const token = ({ audience = projectId, provider = 'anonymous', authTime = now() - 60, exp = now() + 3600 } = {}) =>
    new SignJWT({ auth_time: authTime, firebase: { sign_in_provider: provider } })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(`https://securetoken.google.com/${audience}`)
      .setAudience(audience)
      .setSubject('alice')
      .setIssuedAt(exp - 3600)
      .setExpirationTime(exp)
      .sign(privateKey);

  it('accepts a Firebase token for this project', async () => {
    expect(await verifyIdToken(await token(), projectId, keys)).toEqual({ uid: 'alice', anonymous: true });
    expect(await verifyIdToken(await token({ provider: 'google.com' }), projectId, keys)).toEqual({ uid: 'alice', anonymous: false });
  });

  it.each([
    ['another project', { audience: 'someone-else' }],
    ['an expired token', { exp: now() - 10 }],
    ['sign-in time in the future', { authTime: now() + 600 }],
  ])('rejects %s', async (_, options) => {
    await expect(verifyIdToken(await token(options), projectId, keys)).rejects.toThrow();
  });

  it('asks for sign-in when there is no token', async () => {
    process.env.VITE_FIREBASE_PROJECT_ID = projectId;
    await expect(requirePlayer(new Request('http://x/api/me'))).rejects.toEqual(httpStatus(401));
  });
});

/** Vercel runs api/ as Node ESM, file by file, so relative imports need real file extensions there. */
it('server-side modules import each other with .js extensions', () => {
  const files = ['api', 'server', 'src/game']
    .flatMap((dir) => readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((f) => join(dir, f)))
    .concat('src/net/protocol.ts')
    .filter((f) => f.endsWith('.ts'));
  const bad = files.flatMap((f) =>
    [...readFileSync(f, 'utf8').matchAll(/from '(\.\.?\/[^']+)'/g)].filter((m) => !m[1]!.endsWith('.js')).map((m) => `${f}: ${m[1]}`),
  );
  expect(bad).toEqual([]);
});
