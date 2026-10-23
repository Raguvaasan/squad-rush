export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Wraps a handler so a thrown HttpError becomes its JSON error response, and anything else a logged 500. */
export function route(handler: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Server error' }, 500);
    }
  };
}

/** A 20-minute run that changes direction every tick encodes to about 600 KB; real runs are a few KB. */
const MAX_BODY_CHARS = 1024 * 1024;

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) throw new HttpError(413, 'Request too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}
