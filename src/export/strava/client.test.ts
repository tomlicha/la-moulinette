import { describe, expect, it } from 'vitest';
import { getStatus, sendToStrava } from './client';

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
const fit = new Uint8Array([1, 2, 3]);
const meta = { name: 'Sortie', externalId: 'zwift2-1' };

describe('client du relais Strava', () => {
  it('envoie le FIT avec l’en-tête de garde et les métadonnées', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ activityId: '5', activityUrl: 'https://www.strava.com/activities/5' }));
    }) as typeof fetch;
    const r = await sendToStrava(fit, meta, f);
    expect(r).toEqual({ ok: true, activityUrl: 'https://www.strava.com/activities/5', processing: false });
    expect(seen!.url).toBe('/api/strava/upload?name=Sortie&externalId=zwift2-1');
    expect(seen!.init!.method).toBe('POST');
    expect(seen!.init!.headers).toEqual({ 'x-zwift2': '1' });
  });

  it('signale un traitement encore en cours quand Strava n’a pas fini', async () => {
    expect(await sendToStrava(fit, meta, reply({ uploadId: '9', status: 'Your activity is still being processed.' }))).toEqual({
      ok: true,
      activityUrl: undefined,
      processing: true,
    });
  });

  it('classe les échecs : non configuré, non connecté, refusé par Strava, relais en panne', async () => {
    expect(await sendToStrava(fit, meta, reply({ error: 'not_configured' }, 503))).toMatchObject({ ok: false, reason: 'not_configured' });
    expect(await sendToStrava(fit, meta, reply({ error: 'not_connected' }, 401))).toMatchObject({ ok: false, reason: 'not_connected' });
    expect(await sendToStrava(fit, meta, reply({ error: 'x duplicate of activity 1' }))).toMatchObject({
      ok: false,
      reason: 'rejected',
      message: 'x duplicate of activity 1',
    });
    expect(await sendToStrava(fit, meta, reply({ error: 'strava', message: 'HTTP 503' }, 502))).toMatchObject({
      ok: false,
      reason: 'error',
      message: 'HTTP 503',
    });
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await sendToStrava(fit, meta, down)).toMatchObject({ ok: false, reason: 'error' });
  });

  it('lit le statut, et lève une erreur claire sans relais', async () => {
    expect(await getStatus(reply({ configured: true, connected: false }))).toEqual({ configured: true, connected: false });
    await expect(getStatus(reply('', 404))).rejects.toThrow('HTTP 404');
  });
});
