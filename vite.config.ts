import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import type { Tokens } from './src/export/strava/api';
import { createStravaRelay, PREFIX, type TokenStore } from './src/export/strava/relay';

const TOKEN_FILE = '.strava-tokens.json';

/** Jetons Strava dans un fichier local ignoré par git ; écriture atomique pour ne jamais perdre un jeton de rafraîchissement. */
const fileStore: TokenStore = {
  async load() {
    try {
      return JSON.parse(await readFile(TOKEN_FILE, 'utf8')) as Tokens;
    } catch {
      return undefined;
    }
  },
  async save(tokens) {
    if (!tokens) {
      await unlink(TOKEN_FILE).catch(() => {});
      return;
    }
    await writeFile(`${TOKEN_FILE}.tmp`, JSON.stringify(tokens), 'utf8');
    await rename(`${TOKEN_FILE}.tmp`, TOKEN_FILE);
  },
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Relais Strava dans le serveur de dev. Les variables STRAVA_* ne portent pas le préfixe VITE_ :
 * Vite ne les expose donc jamais au navigateur.
 */
function stravaRelay(env: Record<string, string>): Plugin {
  return {
    name: 'zwift2-strava-relay',
    configureServer(server) {
      const relay = createStravaRelay({
        clientId: env.STRAVA_CLIENT_ID,
        clientSecret: env.STRAVA_CLIENT_SECRET,
        store: fileStore,
      });
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) return next();
        try {
          const method = req.method ?? 'GET';
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await readBody(req));
          const request = new Request(`http://${req.headers.host}${req.url}`, { method, headers, body });
          const response = await relay(request);
          if (!response) return next();
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          res.statusCode = 500;
          res.end(e instanceof Error ? e.message : 'erreur du relais');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [stravaRelay(loadEnv(mode, process.cwd(), 'STRAVA_'))],
  // Chargé à la demande par l'export : sans cela, Vite l'optimise au premier clic et recharge la page, ce qui efface la sortie en cours.
  optimizeDeps: { include: ['@garmin/fitsdk'] },
  test: {
    // Les worktrees d'agents vivent sous .claude/ : leurs copies du code ne sont pas à tester ici.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
}));
