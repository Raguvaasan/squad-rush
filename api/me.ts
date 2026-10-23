import { requirePlayer } from '../server/auth.js';
import { getDb } from '../server/db.js';
import { json, readJson, route } from '../server/http.js';
import { getProfile, rename } from '../server/players.js';

export const GET = route(async (request) => {
  const player = await requirePlayer(request);
  return json(await getProfile(await getDb(), player));
});

export const PATCH = route(async (request) => {
  const player = await requirePlayer(request);
  return json(await rename(await getDb(), player, await readJson(request)));
});
