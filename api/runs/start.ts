import { requirePlayer } from '../../server/auth.js';
import { getDb } from '../../server/db.js';
import { json, route } from '../../server/http.js';
import { startRun } from '../../server/players.js';

export const POST = route(async (request) => {
  const player = await requirePlayer(request);
  return json(await startRun(await getDb(), player));
});
