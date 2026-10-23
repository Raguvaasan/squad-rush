import { initializeApp, type FirebaseError } from '@firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  linkWithPopup,
  signInAnonymously,
  signInWithCredential,
  type Auth,
} from '@firebase/auth';
import type { RunInputs } from '../game/replay';
import type { FirebaseConfig } from './config';
import type { Leaderboard, Profile, RunReward, RunSubmission, RunTicket } from './protocol';

/** Accounts, coins and the leaderboard. Loaded only when Firebase is configured, so the offline game stays small. */
export class Online {
  private nextTicket: Promise<RunTicket | null>;

  private constructor(
    private readonly auth: Auth,
    public profile: Profile,
  ) {
    this.nextTicket = this.requestTicket();
  }

  /** Signs in (anonymously the first time) and loads the player's profile. */
  static async connect(config: FirebaseConfig): Promise<Online> {
    const auth = getAuth(initializeApp(config));
    await auth.authStateReady();
    if (!auth.currentUser) await signInAnonymously(auth);
    return new Online(auth, await call<Profile>(auth, 'GET', '/api/me'));
  }

  /**
   * The seed for the run about to start, waiting at most `waitMs`, and prefetches the one after so the next PLAY
   * doesn't wait at all. Null means the server didn't answer in time and this run is unranked.
   */
  takeTicket(waitMs: number): Promise<RunTicket | null> {
    // A prefetch that failed gets one fresh try inside the same wait.
    const ticket = this.nextTicket.then((t) => t ?? this.requestTicket());
    this.nextTicket = ticket.then(() => this.requestTicket());
    return Promise.race([ticket, new Promise<null>((resolve) => setTimeout(resolve, waitMs, null))]);
  }

  async finish(ticket: RunTicket, inputs: RunInputs, score: number): Promise<RunReward> {
    const submission: RunSubmission = { runId: ticket.runId, inputs, score };
    const reward = await call<RunReward>(this.auth, 'POST', '/api/runs/finish', submission);
    this.profile = reward.profile;
    return reward;
  }

  async leaderboard(): Promise<Leaderboard> {
    const board = await call<Leaderboard>(this.auth, 'GET', '/api/leaderboard');
    this.profile = board.me;
    return board;
  }

  async rename(name: string): Promise<Profile> {
    this.profile = await call<Profile>(this.auth, 'PATCH', '/api/me', { name });
    return this.profile;
  }

  /** Links this anonymous account to Google, keeping its progress. If that Google account already plays, switches to it. */
  async signInWithGoogle(): Promise<Profile> {
    const provider = new GoogleAuthProvider();
    try {
      await linkWithPopup(this.auth.currentUser!, provider);
    } catch (err) {
      const existing =
        (err as FirebaseError).code === 'auth/credential-already-in-use'
          ? GoogleAuthProvider.credentialFromError(err as FirebaseError)
          : null;
      if (!existing) throw err;
      await signInWithCredential(this.auth, existing);
    }
    // The token still says "anonymous" until it's refreshed.
    await this.auth.currentUser!.getIdToken(true);
    this.profile = await call<Profile>(this.auth, 'GET', '/api/me');
    // A prefetched ticket may belong to the account we just left.
    this.nextTicket = this.requestTicket();
    return this.profile;
  }

  private requestTicket(): Promise<RunTicket | null> {
    return call<RunTicket>(this.auth, 'POST', '/api/runs/start').catch((err: unknown) => {
      console.warn('No run ticket; the next run will be unranked.', err);
      return null;
    });
  }
}

async function call<T>(auth: Auth, method: string, path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Finishing a run replays it on the server, which takes a few seconds for a long one.
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || data === null) throw new Error(data?.error ?? `Server error (${response.status})`);
  return data;
}
