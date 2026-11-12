import {
  authorizeUrl,
  exchangeCode,
  refreshTokens,
  StravaError,
  uploadFit,
  waitForUpload,
  type ClientConfig,
  type Fetch,
  type Tokens,
  type UploadStatus,
} from './api.ts';
import { escapeHtml, json, sameOrigin } from '../../util/http.ts';
import { errMsg } from '../../util/errors.ts';

export interface TokenStore {
  load(): Promise<Tokens | undefined>;
  save(tokens: Tokens | undefined): Promise<void>;
}

export interface RelayOptions {
  /** Absents : le relais répond « non configuré » et n'appelle jamais Strava. */
  clientId?: string;
  clientSecret?: string;
  store: TokenStore;
  fetch?: Fetch;
  /** Secondes epoch. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const PREFIX = '/api/strava/';
const MAX_FIT_BYTES = 10 * 1024 * 1024;
const REFRESH_MARGIN_S = 300;
const STATE_TTL_S = 600;
/** En-tête exigé sur les requêtes qui modifient quoi que ce soit : un autre site ne peut pas l'envoyer sans préalerte CORS. */
export const CSRF_HEADER = 'x-zwift2';

/** Page affichée dans la fenêtre de connexion. `message` est échappé : il peut porter un texte venu de Strava. */
const closePage = (message: string, ok: boolean, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Strava</title><body style="font:16px system-ui;padding:2rem">` +
      `<p>${escapeHtml(message)}</p><script>${ok ? "window.opener&&window.opener.postMessage('strava-connected',location.origin);" : ''}` +
      `${ok ? 'setTimeout(()=>window.close(),800)' : ''}</script>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

/**
 * Relais local entre la page et Strava : le secret client et les jetons ne quittent jamais ce module.
 * Renvoie `undefined` pour une URL qui n'est pas de son ressort, afin de passer la main au serveur suivant.
 */
export function createStravaRelay(opts: RelayOptions) {
  const f: Fetch = opts.fetch ?? ((...a) => fetch(...a));
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const cfg: ClientConfig | undefined =
    opts.clientId && opts.clientSecret ? { clientId: opts.clientId, clientSecret: opts.clientSecret } : undefined;
  const states = new Map<string, number>();

  async function freshTokens(force = false): Promise<Tokens | undefined> {
    const t = await opts.store.load();
    if (!t || !cfg) return undefined;
    if (!force && t.expiresAt - now() > REFRESH_MARGIN_S) return t;
    try {
      const next = await refreshTokens(cfg, t.refreshToken, f);
      const saved = { ...next, athlete: next.athlete ?? t.athlete };
      await opts.store.save(saved);
      return saved;
    } catch (e) {
      // Un jeton de rafraîchissement refusé n'est plus récupérable : il faut se reconnecter.
      if (e instanceof StravaError && (e.status === 400 || e.status === 401)) await opts.store.save(undefined);
      throw e;
    }
  }

  /** Retire les états OAuth expirés : une connexion abandonnée ne doit pas en laisser un pour toujours. */
  function purgeStates() {
    const t = now();
    for (const [state, expires] of states) if (expires < t) states.delete(state);
  }

  async function upload(req: Request): Promise<Response> {
    if (!cfg) return json({ error: 'not_configured' }, 503);
    if (!sameOrigin(req) || !req.headers.get(CSRF_HEADER)) return json({ error: 'forbidden' }, 403);
    const fit = new Uint8Array(await req.arrayBuffer());
    if (!fit.length) return json({ error: 'empty' }, 400);
    if (fit.length > MAX_FIT_BYTES) return json({ error: 'too_large' }, 413);

    const url = new URL(req.url);
    const meta = {
      name: url.searchParams.get('name') || 'Sortie La Moulinette',
      externalId: url.searchParams.get('externalId') || `zwift2-${now()}`,
    };

    let tokens: Tokens | undefined;
    try {
      tokens = await freshTokens();
    } catch (e) {
      if (e instanceof StravaError && (e.status === 400 || e.status === 401)) return json({ error: 'not_connected' }, 401);
      return json({ error: 'strava', message: errMsg(e) }, 502);
    }
    if (!tokens) return json({ error: 'not_connected' }, 401);

    let status: UploadStatus;
    try {
      try {
        status = await uploadFit(tokens.accessToken, fit, meta, f);
      } catch (e) {
        if (!(e instanceof StravaError && e.status === 401)) throw e;
        tokens = await freshTokens(true); // jeton révoqué côté Strava : un seul nouvel essai
        if (!tokens) return json({ error: 'not_connected' }, 401);
        status = await uploadFit(tokens.accessToken, fit, meta, f);
      }
      status = await waitForUpload(tokens.accessToken, status, f, opts.sleep);
    } catch (e) {
      if (e instanceof StravaError && e.status === 401) {
        await opts.store.save(undefined);
        return json({ error: 'not_connected' }, 401);
      }
      return json({ error: 'strava', message: errMsg(e) }, 502);
    }
    return json({
      activityId: status.activityId,
      activityUrl: status.activityId ? `https://www.strava.com/activities/${status.activityId}` : undefined,
      error: status.error,
      status: status.status,
      uploadId: status.id,
    });
  }

  return async function handle(req: Request): Promise<Response | undefined> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(PREFIX)) return undefined;
    const route = url.pathname.slice(PREFIX.length);

    if (route === 'status' && req.method === 'GET') {
      const t = cfg ? await opts.store.load() : undefined;
      return json({ configured: !!cfg, connected: !!t, athlete: t?.athlete });
    }

    if (route === 'login' && req.method === 'GET') {
      if (!cfg) return closePage('Strava n’est pas configuré : renseigner STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET dans .env.local.', false, 503);
      purgeStates();
      const state = crypto.randomUUID();
      states.set(state, now() + STATE_TTL_S);
      const redirect = `${url.origin}${PREFIX}callback`;
      return Response.redirect(authorizeUrl(cfg.clientId, redirect, state), 302);
    }

    if (route === 'callback' && req.method === 'GET') {
      if (!cfg) return closePage('Strava n’est pas configuré.', false, 503);
      const state = url.searchParams.get('state') ?? '';
      const expires = states.get(state);
      states.delete(state);
      if (!expires || expires < now()) return closePage('Connexion refusée : état inconnu ou expiré. Relancer depuis la page.', false, 400);
      const code = url.searchParams.get('code');
      if (url.searchParams.get('error') || !code) return closePage('Connexion Strava annulée.', false, 400);
      try {
        await opts.store.save(await exchangeCode(cfg, code, f));
      } catch (e) {
        return closePage(`Échange de jeton impossible : ${errMsg(e)}`, false, 502);
      }
      return closePage('Strava est connecté. Cette fenêtre va se fermer.', true);
    }

    if (route === 'upload' && req.method === 'POST') return upload(req);

    if (route === 'logout' && req.method === 'POST') {
      if (!sameOrigin(req) || !req.headers.get(CSRF_HEADER)) return json({ error: 'forbidden' }, 403);
      await opts.store.save(undefined);
      return json({ connected: false });
    }

    return json({ error: 'not_found' }, 404);
  };
}
