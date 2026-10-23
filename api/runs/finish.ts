import { requirePlayer } from '../../server/auth.js';
import { getDb } from '../../server/db.js';
import { json, readJson, route } from '../../server/http.js';
import { finishRun } from '../../server/players.js';

export const POST = route(async (request) => {
  const player = await requirePlayer(request);
  return json(await finishRun(await getDb(), player, await readJson(request)));
});
