import { LIMITS, parseReport, type StoredReport } from './report.ts';
import { json } from '../util/http.ts';

export const PREFIX = '/api/logs/';

export interface LogStore {
  append(report: StoredReport): Promise<void>;
  /** Les rapports reçus après `since` (ms epoch), du plus ancien au plus récent, au plus `limit`. */
  read(opts: { since?: number; limit: number }): Promise<StoredReport[]>;
}

export interface ReceiverOptions {
  store: LogStore;
  /** Jeton exigé pour déposer un rapport. */
  ingestToken?: string;
  /**
   * Sans `ingestToken`, accepter quand même les dépôts : réservé au serveur de dev, qui n'écoute que sur localhost.
   * Par défaut, un récepteur sans jeton refuse tout : un secret oublié au déploiement ne doit pas ouvrir le dépôt
   * (et le quota gratuit) à tout l'internet.
   */
  allowOpenIngest?: boolean;
  /** Jeton exigé pour lire. Absent : la lecture répond « non configuré ». */
  readToken?: string;
  /** Origine autorisée à déposer depuis un navigateur ; `*` par défaut. */
  allowedOrigin?: string;
  now?: () => number;
}

/** Comparaison en temps constant, pour ne pas laisser deviner un jeton caractère par caractère. */
function sameToken(given: string | null, expected: string): boolean {
  const a = new TextEncoder().encode(given ?? '');
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!;
  return diff === 0;
}

const bearer = (req: Request) => req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;

/**
 * Récepteur de journaux : `POST /api/logs/ingest` dépose un rapport, `GET /api/logs/reports` les relit.
 * Indépendant de Vite et de Node (Request vers Response) : il se branche aussi bien sur le serveur de dev,
 * sur `tools/log-server.ts` que sur un Worker. Renvoie `undefined` pour une URL qui n'est pas de son ressort.
 */
export function createLogReceiver(opts: ReceiverOptions) {
  const now = opts.now ?? Date.now;
  const cors = {
    'access-control-allow-origin': opts.allowedOrigin ?? '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };

  return async function handle(req: Request): Promise<Response | undefined> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(PREFIX)) return undefined;
    const route = url.pathname.slice(PREFIX.length);

    if (route === 'ingest') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
      if (!opts.ingestToken && !opts.allowOpenIngest) return json({ error: 'not_configured' }, 503, cors);
      if (opts.ingestToken && !sameToken(bearer(req), opts.ingestToken)) return json({ error: 'forbidden' }, 403, cors);
      // Refus avant lecture : un Worker ne doit pas avaler un corps de plusieurs mégaoctets pour le jeter ensuite.
      if (Number(req.headers.get('content-length')) > LIMITS.bodyBytes) return json({ error: 'too_large' }, 413, cors);
      const text = await req.text();
      if (new TextEncoder().encode(text).length > LIMITS.bodyBytes) return json({ error: 'too_large' }, 413, cors);
      let parsed;
      try {
        parsed = parseReport(JSON.parse(text));
      } catch {
        parsed = undefined;
      }
      if (!parsed) return json({ error: 'invalid_report' }, 400, cors);
      await opts.store.append({ ...parsed, receivedAt: now() });
      return json({ ok: true }, 200, cors);
    }

    if (route === 'reports' && req.method === 'GET') {
      if (!opts.readToken) return json({ error: 'not_configured' }, 503);
      if (!sameToken(bearer(req), opts.readToken)) return json({ error: 'forbidden' }, 403);
      const since = Number(url.searchParams.get('since')) || undefined;
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 500);
      return json({ reports: await opts.store.read({ since, limit }) });
    }

    return json({ error: 'not_found' }, 404);
  };
}
