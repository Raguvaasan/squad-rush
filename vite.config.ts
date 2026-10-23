import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // The API reads process.env, as on Vercel. Vite only hands .env files to client code, so copy them over for dev.
  // Not under Vitest: tests must never pick up a real MONGODB_URI from .env.local.
  if (!process.env.VITEST) {
    for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) process.env[key] ??= value;
  }

  return {
    plugins: [devApi()],
    build: {
      target: 'es2022',
      // three.js alone is ~700 KB minified; it's one cached chunk, so the default 500 KB warning is noise.
      chunkSizeWarningLimit: 900,
    },
    test: {
      include: ['tests/**/*.test.ts'],
    },
  };
});

/** Serves api/**.ts during `npm run dev` the way Vercel does in production: one file per path, one export per method. */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (!url.pathname.startsWith('/api/')) return next();
        const file = `api${url.pathname.slice('/api'.length)}.ts`;
        if (!existsSync(file)) {
          // As on Vercel; otherwise Vite would answer with index.html.
          res.statusCode = 404;
          res.end();
          return;
        }

        (async () => {
          const routes = await server.ssrLoadModule(`/${file}`);
          const handler: unknown = routes[req.method ?? 'GET'];
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            res.end();
            return;
          }
          const response = (await handler(await toRequest(req, url))) as Response;
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        })().catch(next);
      });
    },
  };
}

async function toRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks).toString() : undefined });
}
