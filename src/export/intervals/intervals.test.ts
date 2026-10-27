import { describe, expect, it } from 'vitest';
import { basicAuth, IntervalsError, uploadActivity } from './api';
import { createIntervalsRelay } from './relay';
import { getStatus, sendToIntervals } from './client';
import { CSRF_HEADER } from '../strava/relay';

const KEY = 'cle-de-test-ne-doit-jamais-sortir';
const ORIGIN = 'http://localhost:5173';
const FIT = Uint8Array.from([14, 0x10, 0, 0, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54, 1, 2, 3, 4]);

interface Call {
  url: string;
  method: string;
  auth?: string;
  body?: FormData;
}

/** Faux intervals.icu : une réponse imposée, appels enregistrés. Aucun réseau. */
function fakeIntervals(respond: () => Response) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
      body: init?.body as FormData,
    });
    return respond();
  }) as typeof fetch;
  return { fetcher, calls };
}

const created = () => new Response(JSON.stringify([{ id: 'i123456', athlete_id: 'i1' }]), { status: 201 });
const duplicate = () => new Response('[]', { status: 200 });

describe('uploadActivity', () => {
  it("envoie le fichier en multipart avec l'authentification basique API_KEY", async () => {
    const { fetcher, calls } = fakeIntervals(created);
    const r = await uploadActivity(KEY, FIT, { name: 'Sortie du jour', externalId: 'zwift2-1', description: 'test' }, fetcher);

    const call = calls[0]!;
    const url = new URL(call.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://intervals.icu/api/v1/athlete/0/activities');
    expect(url.searchParams.get('name')).toBe('Sortie du jour');
    expect(url.searchParams.get('external_id')).toBe('zwift2-1');
    expect(url.searchParams.get('description')).toBe('test');
    expect(call.method).toBe('POST');
    expect(call.auth).toBe(`Basic ${btoa(`API_KEY:${KEY}`)}`);
    const file = call.body!.get('file') as File;
    expect(file.name).toBe('zwift2-1.fit');
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([...FIT]);
    expect(r).toEqual({ created: true, activityId: 'i123456' });
  });

  it("lit l'identifiant dans la forme réellement renvoyée par intervals.icu", async () => {
    const real = { icu_athlete_id: 'i1', id: 'i202546479', activities: [{ icu_athlete_id: 'i1', id: 'i202546479' }] };
    const { fetcher } = fakeIntervals(() => new Response(JSON.stringify(real), { status: 201 }));
    expect(await uploadActivity(KEY, FIT, { name: 'x', externalId: 'y' }, fetcher)).toEqual({ created: true, activityId: 'i202546479' });

    const onlyList = { activities: [{ id: 'i7' }] };
    const f2 = fakeIntervals(() => new Response(JSON.stringify(onlyList), { status: 200 })).fetcher;
    expect(await uploadActivity(KEY, FIT, { name: 'x', externalId: 'y' }, f2)).toEqual({ created: false, activityId: 'i7' });
  });

  it('distingue un doublon (200) d\'une création (201)', async () => {
    const { fetcher } = fakeIntervals(duplicate);
    expect(await uploadActivity(KEY, FIT, { name: 'x', externalId: 'y' }, fetcher)).toEqual({ created: false, activityId: undefined });
  });

  it('tolère une réponse sans identifiant lisible', async () => {
    const { fetcher } = fakeIntervals(() => new Response('pas du json', { status: 201 }));
    expect(await uploadActivity(KEY, FIT, { name: 'x', externalId: 'y' }, fetcher)).toEqual({ created: true, activityId: undefined });
  });

  it('lève une erreur typée si la clé est refusée', async () => {
    for (const status of [401, 403]) {
      const { fetcher } = fakeIntervals(() => new Response('', { status }));
      await expect(uploadActivity(KEY, FIT, { name: 'x', externalId: 'y' }, fetcher)).rejects.toMatchObject({
        constructor: IntervalsError,
        status,
      });
    }
  });

  it('lève une erreur sur un autre échec HTTP', async () => {
    const { fetcher } = fakeIntervals(() => new Response('', { status: 500 }));
    await expect(uploadActivity(KEY, FIT, { name: 'x', externalId: 'y' }, fetcher)).rejects.toThrow('HTTP 500');
  });

  it('calcule le bon en-tête basique', () => {
    expect(basicAuth('abc')).toBe('Basic QVBJX0tFWTphYmM=');
  });
});

describe('relais intervals.icu', () => {
  const post = (path: string, over: { body?: Uint8Array; headers?: Record<string, string> } = {}) =>
    new Request(`${ORIGIN}/api/intervals/${path}`, {
      method: 'POST',
      headers: { [CSRF_HEADER]: '1', ...over.headers },
      body: (over.body ?? FIT) as BodyInit,
    });

  it("répond « non configuré » sans clé et n'appelle jamais intervals.icu", async () => {
    const { fetcher, calls } = fakeIntervals(created);
    const relay = createIntervalsRelay({ fetch: fetcher });
    const status = await relay(new Request(`${ORIGIN}/api/intervals/status`));
    expect(await status!.json()).toEqual({ configured: false });
    expect((await relay(post('upload')))!.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('dépose le fichier et renvoie le lien de l\'activité, sans jamais exposer la clé', async () => {
    const { fetcher, calls } = fakeIntervals(created);
    const relay = createIntervalsRelay({ apiKey: KEY, fetch: fetcher });
    const status = await relay(new Request(`${ORIGIN}/api/intervals/status`));
    expect(await status!.json()).toEqual({ configured: true });

    const res = await relay(post('upload?name=Ma%20sortie&externalId=zwift2-9'));
    const text = await res!.text();
    expect(res!.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      created: true,
      activityId: 'i123456',
      activityUrl: 'https://intervals.icu/activities/i123456',
    });
    expect(text).not.toContain(KEY);
    expect(calls[0]!.auth).toBe(basicAuth(KEY));
    expect(new URL(calls[0]!.url).searchParams.get('external_id')).toBe('zwift2-9');
  });

  it('refuse sans en-tête anti-CSRF ou depuis une autre origine', async () => {
    const { fetcher, calls } = fakeIntervals(created);
    const relay = createIntervalsRelay({ apiKey: KEY, fetch: fetcher });
    const sans = new Request(`${ORIGIN}/api/intervals/upload`, { method: 'POST', body: FIT as BodyInit });
    expect((await relay(sans))!.status).toBe(403);
    expect((await relay(post('upload', { headers: { origin: 'https://pirate.example' } })))!.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('rejette un corps vide ou trop gros', async () => {
    const { fetcher } = fakeIntervals(created);
    const relay = createIntervalsRelay({ apiKey: KEY, fetch: fetcher });
    expect((await relay(post('upload', { body: new Uint8Array() })))!.status).toBe(400);
    expect((await relay(post('upload', { body: new Uint8Array(10 * 1024 * 1024 + 1) })))!.status).toBe(413);
  });

  it('traduit une clé refusée en 401 et une panne en 502, sans fuite de la clé', async () => {
    const refused = createIntervalsRelay({ apiKey: KEY, fetch: fakeIntervals(() => new Response('', { status: 401 })).fetcher });
    const r1 = await refused(post('upload'));
    expect(r1!.status).toBe(401);
    expect(await r1!.json()).toEqual({ error: 'invalid_key' });

    const down = createIntervalsRelay({ apiKey: KEY, fetch: fakeIntervals(() => new Response('', { status: 500 })).fetcher });
    const r2 = await down(post('upload'));
    expect(r2!.status).toBe(502);
    expect(await r2!.text()).not.toContain(KEY);
  });

  it("passe la main pour une URL qui n'est pas la sienne", async () => {
    const relay = createIntervalsRelay({ apiKey: KEY });
    expect(await relay(new Request(`${ORIGIN}/api/strava/status`))).toBeUndefined();
    expect((await relay(new Request(`${ORIGIN}/api/intervals/inconnu`)))!.status).toBe(404);
  });
});

describe('client navigateur', () => {
  it('lit le statut et envoie par le relais avec l\'en-tête anti-CSRF', async () => {
    const seen: { url: string; csrf?: string }[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), csrf: (init?.headers as Record<string, string> | undefined)?.[CSRF_HEADER] });
      return String(input).endsWith('status')
        ? new Response(JSON.stringify({ configured: true }))
        : new Response(JSON.stringify({ created: true, activityUrl: 'https://intervals.icu/activities/i1' }));
    }) as typeof fetch;

    expect(await getStatus(f)).toEqual({ configured: true });
    expect(await sendToIntervals(FIT, { name: 'n', externalId: 'e' }, f)).toEqual({
      ok: true,
      created: true,
      activityUrl: 'https://intervals.icu/activities/i1',
    });
    expect(seen[1]!.csrf).toBe('1');
  });

  it('traduit les codes du relais en raisons lisibles', async () => {
    const reply = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch;
    expect(await sendToIntervals(FIT, { name: 'n', externalId: 'e' }, reply(503))).toMatchObject({ ok: false, reason: 'not_configured' });
    expect(await sendToIntervals(FIT, { name: 'n', externalId: 'e' }, reply(401))).toMatchObject({ ok: false, reason: 'invalid_key' });
    expect(await sendToIntervals(FIT, { name: 'n', externalId: 'e' }, reply(502))).toMatchObject({ ok: false, reason: 'error' });
    const down = (async () => {
      throw new Error('réseau');
    }) as unknown as typeof fetch;
    expect(await sendToIntervals(FIT, { name: 'n', externalId: 'e' }, down)).toMatchObject({ ok: false, reason: 'error' });
  });
});
