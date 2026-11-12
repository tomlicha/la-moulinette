/**
 * Récepteur de journaux sur Cloudflare Workers : le même gestionnaire que `tools/log-server.ts`, avec D1 pour stockage.
 * Secrets à créer avec `npx wrangler secret put INGEST_TOKEN` et `READ_TOKEN` ; jamais dans wrangler.toml.
 */
import { createLogReceiver } from '../src/telemetry/receiver.ts';
import { createD1Store, RETENTION_MS, type D1Database } from './d1-store.ts';

interface Env {
  DB: D1Database;
  INGEST_TOKEN?: string;
  READ_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const receiver = createLogReceiver({
      store: createD1Store(env.DB),
      ingestToken: env.INGEST_TOKEN,
      readToken: env.READ_TOKEN,
      allowedOrigin: env.ALLOWED_ORIGIN,
    });
    return (await receiver(req)) ?? new Response('not found', { status: 404 });
  },

  /** Déclenché chaque nuit par `[triggers] crons` : garde 30 jours de rapports. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await createD1Store(env.DB).purge(Date.now() - RETENTION_MS);
  },
};
