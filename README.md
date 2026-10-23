# squad-rush

Endless squad runner: steer through gates, grow your army, beat the bosses. Vite + TypeScript + three.js, with
accounts, coins and a server-verified leaderboard on Vercel, Firebase Auth and MongoDB.

```sh
npm install
npm run dev      # game + API on http://localhost:5173
npm run verify   # type-check, tests, production build
```

Without Firebase config the game runs fully offline; the account strip and leaderboard simply don't appear.

## How scores are verified

The simulation is deterministic: a run is fully described by its seed plus the steering value on every tick.

1. On PLAY the client takes a seed from `POST /api/runs/start` (prefetched, so there is no wait).
2. During the run it records steering per tick (`src/game/replay.ts`).
3. When the squad is lost it posts the inputs to `POST /api/runs/finish`. The server replays the run from the seed,
   and only a run that ends exactly where the inputs end counts. It awards coins (1 per 100 points) and updates
   the best score.

Each ticket pays out once, a run can't be submitted sooner than it took to play, and a player holds at most three
open tickets. This stops made-up scores, not a bot that plays in real time.

## Setting up online play

1. **Firebase** (console.firebase.google.com): create a project and add a Web app. In Authentication > Sign-in
   method, enable **Anonymous** and **Google**. In Authentication > Settings > Authorized domains, add your Vercel
   domain. Copy the web config into `VITE_FIREBASE_*`.
2. **MongoDB Atlas**: create a free cluster and a database user, then copy the connection string into `MONGODB_URI`.
   Under Network Access allow `0.0.0.0/0`, since Vercel functions don't have fixed IPs.
3. **Locally**: copy `.env.example` to `.env.local` and fill it in. `npm run dev` serves `api/` too.
4. **Vercel**: import the GitHub repo (framework preset: Vite) and add the same variables under Project Settings >
   Environment Variables.

## Layout

| Path | What |
| --- | --- |
| `src/game/` | Deterministic simulation, shared by the browser and the server |
| `src/render/`, `src/ui/` | three.js scene and DOM overlay |
| `src/net/` | Firebase sign-in and API client (lazy-loaded), plus the request/response types |
| `api/` | Vercel functions: one file per route, one export per HTTP method |
| `server/` | Token checks, MongoDB access and the game rules behind the API |

Vercel compiles `api/` file by file as Node ESM, so everything the server imports (`api/`, `server/`, `src/game/`,
`src/net/protocol.ts`) uses `.js` extensions on relative imports. A test enforces it.
