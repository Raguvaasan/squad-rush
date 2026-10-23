import { MongoClient, type Collection, type Db } from 'mongodb';

export interface UserDoc {
  /** The Firebase uid. */
  _id: string;
  name: string;
  coins: number;
  best: number;
  /** When `best` was set; earlier wins a tie on the leaderboard. */
  bestAt: Date | null;
  runs: number;
  createdAt: Date;
}

export interface RunDoc {
  _id: string;
  uid: string;
  seed: number;
  startedAt: Date;
  /** Set when the run is submitted, before it's checked, so each ticket pays out at most once. */
  finishedAt: Date | null;
  score?: number;
  rejected?: string;
}

export const users = (db: Db): Collection<UserDoc> => db.collection<UserDoc>('users');
export const runs = (db: Db): Collection<RunDoc> => db.collection<RunDoc>('runs');

let client: MongoClient | null = null;
let connection: Promise<Db> | null = null;

/** One client per warm function instance: Vercel reuses the module between requests. */
export function getDb(): Promise<Db> {
  connection ??= connect().catch((err: unknown) => {
    connection = null;
    throw err;
  });
  return connection;
}

async function connect(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'squad-rush');
  await Promise.all([
    users(db).createIndex({ best: -1, bestAt: 1 }),
    runs(db).createIndex({ uid: 1, finishedAt: 1, startedAt: -1 }),
  ]);
  return db;
}

export async function closeDb(): Promise<void> {
  const open = client;
  client = null;
  connection = null;
  await open?.close();
}
