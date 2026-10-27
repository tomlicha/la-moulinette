import { describe, expect, it } from 'vitest';
import { createStravaRelay, CSRF_HEADER, type TokenStore } from './relay';
import type { Tokens } from './api';

const ORIGIN = 'http://localhost:5173';
const SECRET = 'secret-de-test-ne-doit-jamais-sortir';
const NOW = 1_800_000_000;

function memoryStore(initial?: Tokens) {
  let t = initial;
  const saves: (Tokens | undefined)[] = [];
  const store: TokenStore = {
    load: async () => t,
    save: async (x) => {
      t = x;
      saves.push(x);
    },
  };
  return { store, saves, get: () => t };
}

interface Call {
  url: string;
  method: string;
  body?: BodyInit | null;
  auth?: string;
}

/** Faux Strava : réponses par route, appels enregistrés. Aucun réseau. */
function fakeStrava(handlers: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    };
    calls.push(call);
    const key = `${call.method} ${new URL(url).pathname}`;
    const h = handlers[key];
    if (!h) throw new Error(`appel Strava inattendu : ${key}`);
    return h(call);
  }) as typeof fetch;
  return { fetcher, calls };
}

const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const tokenBody = (over: Record<string, unknown> = {}) => ({
  access_token: 'acc-new',
  refresh_token: 'ref-new',
  expires_at: NOW + 21_600,
  athlete: { firstname: 'Tom', lastname: 'L' },
  ...over,
});

const valid: Tokens = { accessToken: 'acc', refreshToken: 'ref', expiresAt: NOW + 3600, athlete: 'Tom L' };

function setup(over: { tokens?: Tokens; strava?: Record<string, (c: Call) => Response>; configured?: boolean } = {}) {
  const mem = memoryStore(over.tokens);
  const strava = fakeStrava(over.strava ?? {});
  const relay = createStravaRelay({
    clientId: over.configured === false ? undefined : '12345',
    clientSecret: over.configured === false ? undefined : SECRET,
    store: mem.store,
    fetch: strava.fetcher,
    now: () => NOW,
    sleep: async () => {},
  });
  return { relay, mem, strava };
}

const get = (path: string) => new Request(`${ORIGIN}${path}`);
const post = (path: string, body: BodyInit = new Uint8Array([1, 2, 3]), headers: Record<string, string> = { [CSRF_HEADER]: '1' }) =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', body, headers });

describe('relais Strava, configuration et connexion', () => {
  it("laisse passer les URL qui ne sont pas les siennes", async () => {
    const { relay } = setup();
    expect(await relay(get('/index.html'))).toBeUndefined();
  });

  it("annonce « non configuré » sans jamais appeler Strava", async () => {
    const { relay, strava } = setup({ configured: false });
    expect(await (await relay(get('/api/strava/status')))!.json()).toEqual({ configured: false, connected: false });
    expect((await relay(get('/api/strava/login')))!.status).toBe(503);
    expect((await relay(post('/api/strava/upload')))!.status).toBe(503);
    expect(strava.calls).toEqual([]);
  });

  it("redirige vers Strava avec le bon scope, sans le secret", async () => {
    const { relay } = setup();
    const res = (await relay(get('/api/strava/login')))!;
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(loc.searchParams.get('client_id')).toBe('12345');
    expect(loc.searchParams.get('scope')).toBe('activity:write');
    expect(loc.searchParams.get('response_type')).toBe('code');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/strava/callback`);
    expect(loc.toString()).not.toContain(SECRET);
  });

  it('échange le code contre des jetons et les range dans le magasin', async () => {
    const { relay, mem, strava } = setup({ strava: { 'POST /oauth/token': () => j(tokenBody()) } });
    const state = new URL((await relay(get('/api/strava/login')))!.headers.get('location')!).searchParams.get('state')!;
    const res = (await relay(get(`/api/strava/callback?code=abc&state=${state}`)))!;
    expect(res.status).toBe(200);
    expect(mem.get()).toMatchObject({ accessToken: 'acc-new', refreshToken: 'ref-new', athlete: 'Tom L' });

    const sent = new URLSearchParams(String(strava.calls[0]!.body));
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('abc');
    expect(sent.get('client_secret')).toBe(SECRET); // le secret ne part que vers Strava, côté serveur
  });

  it("refuse un retour OAuth dont l'état est inconnu ou déjà utilisé", async () => {
    const { relay, mem, strava } = setup({ strava: { 'POST /oauth/token': () => j(tokenBody()) } });
    expect((await relay(get('/api/strava/callback?code=abc&state=forge')))!.status).toBe(400);
    const state = new URL((await relay(get('/api/strava/login')))!.headers.get('location')!).searchParams.get('state')!;
    await relay(get(`/api/strava/callback?code=abc&state=${state}`));
    expect((await relay(get(`/api/strava/callback?code=abc&state=${state}`)))!.status).toBe(400);
    expect(strava.calls).toHaveLength(1);
    expect(mem.saves).toHaveLength(1);
  });

  it("n'échange rien quand l'utilisateur refuse l'autorisation", async () => {
    const { relay, strava } = setup();
    const state = new URL((await relay(get('/api/strava/login')))!.headers.get('location')!).searchParams.get('state')!;
    const res = (await relay(get(`/api/strava/callback?error=access_denied&state=${state}`)))!;
    expect(res.status).toBe(400);
    expect(strava.calls).toEqual([]);
  });

  it("le statut ne contient jamais de jeton ni de secret", async () => {
    const { relay } = setup({ tokens: valid });
    const text = await (await relay(get('/api/strava/status')))!.text();
    expect(JSON.parse(text)).toEqual({ configured: true, connected: true, athlete: 'Tom L' });
    expect(text).not.toContain('acc');
    expect(text).not.toContain(SECRET);
  });
});

const uploadOk = (over: Record<string, unknown> = {}) => () =>
  j({ id_str: '99', status: 'Your activity is still being processed.', error: null, activity_id: null, ...over }, 201);

describe('relais Strava, dépôt', () => {
  it('dépose le FIT en multipart, marque une sortie sur trainer et suit jusqu’à l’activité', async () => {
    let polls = 0;
    const { relay, strava } = setup({
      tokens: valid,
      strava: {
        'POST /api/v3/uploads': uploadOk(),
        'GET /api/v3/uploads/99': () =>
          ++polls < 3
            ? j({ id_str: '99', status: 'Your activity is still being processed.', error: null, activity_id: null })
            : j({ id_str: '99', status: 'Your activity is ready.', error: null, activity_id: 555, activity_id_str: '555' }),
      },
    });
    const res = (await relay(post('/api/strava/upload?name=Ma%20sortie&externalId=zwift2-1', new Uint8Array([9, 9, 9]))))!;
    expect(await res.json()).toMatchObject({ activityId: '555', activityUrl: 'https://www.strava.com/activities/555' });

    const up = strava.calls[0]!;
    expect(up.auth).toBe('Bearer acc');
    const form = up.body as FormData;
    expect(form.get('data_type')).toBe('fit');
    expect(form.get('sport_type')).toBe('VirtualRide');
    expect(form.get('trainer')).toBe('1');
    expect(form.get('name')).toBe('Ma sortie');
    expect(form.get('external_id')).toBe('zwift2-1');
    expect(new Uint8Array(await (form.get('file') as Blob).arrayBuffer())).toEqual(new Uint8Array([9, 9, 9]));
    expect(polls).toBe(3);
  });

  it('remonte un doublon comme une erreur lisible, sans activité', async () => {
    const { relay } = setup({
      tokens: valid,
      strava: {
        'POST /api/v3/uploads': uploadOk({ error: 'zwift2-1.fit duplicate of activity 21234316', status: 'There was an error processing your activity.' }),
      },
    });
    const body = await (await relay(post('/api/strava/upload')))!.json();
    expect(body.activityId).toBeUndefined();
    expect(body.error).toContain('duplicate of activity 21234316');
  });

  it("rend la main sans erreur si Strava est encore en traitement après toutes les interrogations", async () => {
    const { relay, strava } = setup({
      tokens: valid,
      strava: {
        'POST /api/v3/uploads': uploadOk(),
        'GET /api/v3/uploads/99': () => j({ id_str: '99', status: 'Your activity is still being processed.', error: null, activity_id: null }),
      },
    });
    const body = await (await relay(post('/api/strava/upload')))!.json();
    expect(body).toMatchObject({ uploadId: '99', status: 'Your activity is still being processed.' });
    expect(body.activityId).toBeUndefined();
    expect(strava.calls.filter((c) => c.method === 'GET')).toHaveLength(10);
  });

  it('rafraîchit un jeton proche de l’expiration et sauvegarde le nouveau jeton de rafraîchissement', async () => {
    const { relay, mem, strava } = setup({
      tokens: { ...valid, expiresAt: NOW + 60 },
      strava: {
        'POST /oauth/token': () => j(tokenBody({ athlete: undefined })),
        'POST /api/v3/uploads': uploadOk({ activity_id: 7, activity_id_str: '7' }),
      },
    });
    await relay(post('/api/strava/upload'));
    const refresh = new URLSearchParams(String(strava.calls[0]!.body));
    expect(refresh.get('grant_type')).toBe('refresh_token');
    expect(refresh.get('refresh_token')).toBe('ref');
    expect(strava.calls[1]!.auth).toBe('Bearer acc-new');
    expect(mem.get()).toMatchObject({ refreshToken: 'ref-new', athlete: 'Tom L' }); // le nom est conservé
  });

  it("réessaie une fois avec un jeton neuf si Strava répond 401", async () => {
    let first = true;
    const { relay, strava } = setup({
      tokens: valid,
      strava: {
        'POST /oauth/token': () => j(tokenBody()),
        'POST /api/v3/uploads': (c) => {
          if (first) {
            first = false;
            return j({ message: 'Authorization Error' }, 401);
          }
          expect(c.auth).toBe('Bearer acc-new');
          return uploadOk({ activity_id: 8, activity_id_str: '8' })();
        },
      },
    });
    const body = await (await relay(post('/api/strava/upload')))!.json();
    expect(body.activityId).toBe('8');
    expect(strava.calls.map((c) => c.method + new URL(c.url).pathname)).toEqual([
      'POST/api/v3/uploads',
      'POST/oauth/token',
      'POST/api/v3/uploads',
    ]);
  });

  it("efface les jetons et demande de se reconnecter quand le rafraîchissement est refusé", async () => {
    const { relay, mem } = setup({
      tokens: { ...valid, expiresAt: NOW - 10 },
      strava: { 'POST /oauth/token': () => j({ message: 'Bad Request' }, 400) },
    });
    const res = (await relay(post('/api/strava/upload')))!;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'not_connected' });
    expect(mem.get()).toBeUndefined();
  });

  it("garde les jetons quand le rafraîchissement échoue pour une raison réseau", async () => {
    const { relay, mem } = setup({
      tokens: { ...valid, expiresAt: NOW - 10 },
      strava: { 'POST /oauth/token': () => j({}, 503) },
    });
    const res = (await relay(post('/api/strava/upload')))!;
    expect(res.status).toBe(502);
    expect(mem.get()).toBeDefined();
  });

  it('exige une connexion préalable', async () => {
    const { relay, strava } = setup();
    expect((await relay(post('/api/strava/upload')))!.status).toBe(401);
    expect(strava.calls).toEqual([]);
  });

  it('refuse une requête sans en-tête de garde ou venant d’un autre site', async () => {
    const { relay, strava } = setup({ tokens: valid });
    expect((await relay(post('/api/strava/upload', undefined, {})))!.status).toBe(403);
    expect((await relay(post('/api/strava/upload', undefined, { [CSRF_HEADER]: '1', origin: 'https://evil.example' })))!.status).toBe(403);
    expect((await relay(post('/api/strava/logout', undefined, {})))!.status).toBe(403);
    expect(strava.calls).toEqual([]);
  });

  it('refuse un corps vide ou trop gros', async () => {
    const { relay } = setup({ tokens: valid });
    expect((await relay(post('/api/strava/upload', new Uint8Array())))!.status).toBe(400);
    expect((await relay(post('/api/strava/upload', new Uint8Array(10 * 1024 * 1024 + 1))))!.status).toBe(413);
  });

  it('se déconnecte en effaçant les jetons', async () => {
    const { relay, mem } = setup({ tokens: valid });
    expect((await relay(post('/api/strava/logout')))!.status).toBe(200);
    expect(mem.get()).toBeUndefined();
  });
});
