import { CSRF_HEADER } from '../strava/relay';
import { INTERVALS_SITE, IntervalsError, uploadActivity, type Fetch } from './api';

export const PREFIX = '/api/intervals/';
const MAX_FIT_BYTES = 10 * 1024 * 1024;

export interface RelayOptions {
  /** Absente : le relais répond « non configuré » et n'appelle jamais intervals.icu. */
  apiKey?: string;
  fetch?: Fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Relais local entre la page et intervals.icu : la clé d'API ne quitte jamais ce module, donc jamais le navigateur.
 * Renvoie `undefined` pour une URL qui n'est pas de son ressort, afin de passer la main au serveur suivant.
 */
export function createIntervalsRelay(opts: RelayOptions) {
  const f: Fetch = opts.fetch ?? ((...a) => fetch(...a));
  const apiKey = opts.apiKey?.trim() || undefined;

  const sameOrigin = (req: Request) => {
    const origin = req.headers.get('origin');
    return !origin || new URL(origin).host === new URL(req.url).host;
  };

  return async function handle(req: Request): Promise<Response | undefined> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(PREFIX)) return undefined;
    const route = url.pathname.slice(PREFIX.length);

    if (route === 'status' && req.method === 'GET') return json({ configured: !!apiKey });

    if (route === 'upload' && req.method === 'POST') {
      if (!apiKey) return json({ error: 'not_configured' }, 503);
      if (!sameOrigin(req) || !req.headers.get(CSRF_HEADER)) return json({ error: 'forbidden' }, 403);
      const fit = new Uint8Array(await req.arrayBuffer());
      if (!fit.length) return json({ error: 'empty' }, 400);
      if (fit.length > MAX_FIT_BYTES) return json({ error: 'too_large' }, 413);

      const meta = {
        name: url.searchParams.get('name') || 'Sortie zwift-2',
        externalId: url.searchParams.get('externalId') || `zwift2-${Date.now()}`,
      };
      try {
        const r = await uploadActivity(apiKey, fit, meta, f);
        return json({
          created: r.created,
          activityId: r.activityId,
          activityUrl: r.activityId ? `${INTERVALS_SITE}/activities/${r.activityId}` : undefined,
        });
      } catch (e) {
        if (e instanceof IntervalsError && (e.status === 401 || e.status === 403)) return json({ error: 'invalid_key' }, 401);
        return json({ error: 'intervals', message: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    return json({ error: 'not_found' }, 404);
  };
}
