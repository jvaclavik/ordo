// Serves the Vercel functions in api/ from the Vite dev server, so the
// Google Calendar sign-in works with plain `npm run dev`. Production uses
// Vercel's own runtime and never loads this file.
import type { IncomingMessage } from "node:http";
import { loadEnv, type Plugin } from "vite";

const ROUTES: Array<{ prefix: string; module: string }> = [
  { prefix: "/api/gcal/", module: "/api/gcal/[op].js" },
];

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GCAL_COOKIE_SECRET"];

type Handler = (request: Request) => Promise<Response>;

async function readBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk as Uint8Array);
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks);
}

export function devApi(): Plugin {
  return {
    name: "ordo-dev-api",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.envDir || server.config.root, "");
      for (const key of ENV_KEYS) {
        if (env[key] && !process.env[key]) process.env[key] = env[key];
      }
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0] ?? "";
        const route = ROUTES.find((entry) => path.startsWith(entry.prefix));
        if (!route) return next();
        try {
          const loaded = (await server.ssrLoadModule(route.module)) as Record<string, unknown>;
          const method = req.method ?? "GET";
          const handler = loaded[method] as Handler | undefined;
          if (typeof handler !== "function") {
            res.statusCode = 405;
            res.end();
            return;
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) {
            if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
            else if (value !== undefined) headers.set(name, value);
          }
          const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
          const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
          const response = await handler(
            new Request(url, { method, headers, ...(body ? { body } : {}) })
          );
          res.statusCode = response.status;
          response.headers.forEach((value, name) => {
            if (name !== "set-cookie") res.setHeader(name, value);
          });
          const cookies = response.headers.getSetCookie();
          if (cookies.length > 0) res.setHeader("set-cookie", cookies);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
