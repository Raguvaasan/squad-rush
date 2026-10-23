import { requirePlayer } from '../server/auth.js';
import { getDb } from '../server/db.js';
import { json, route } from '../server/http.js';
import { getLeaderboard } from '../server/players.js';

export const GET = route(async (request) => {
  const player = await requirePlayer(request);
  return json(await getLeaderboard(await getDb(), player));
});
