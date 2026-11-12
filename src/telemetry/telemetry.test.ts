import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogBuffer } from './log-buffer';
import { createLogReceiver, type LogStore } from './receiver';
import { createReporter, MAX_BODY_BYTES } from './reporter';
import { LIMITS, parseReport, type Level, type LogEntry, type StoredReport } from './report';

describe('LogBuffer', () => {
  it("prend le niveau donné par l'appelant, information par défaut", () => {
    const b = new LogBuffer();
    // Avant, le niveau était deviné d'après les mots : « indisponible » faisait partir un rapport à chaque lancement.
    expect(b.add('reconnexion automatique indisponible').level).toBe('info');
    expect(b.add('échec de connexion', 'error').level).toBe('error');
  });

  it('tronque les lignes trop longues', () => {
    expect(new LogBuffer().add('x'.repeat(5000)).msg).toHaveLength(LIMITS.msgChars);
  });

  it('garde les dernières lignes et numérote sans trou', () => {
    const b = new LogBuffer(3);
    for (const m of ['a', 'b', 'c', 'd']) b.add(m);
    expect(b.since(0).map((e) => [e.n, e.msg])).toEqual([[2, 'b'], [3, 'c'], [4, 'd']]);
    expect(b.since(3).map((e) => e.msg)).toEqual(['d']);
  });
});

describe('Reporter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (fetchImpl: typeof fetch) => {
    const buffer = new LogBuffer();
    const reporter = createReporter(buffer, {
      endpoint: 'https://logs.test/api/logs/ingest',
      token: 'tok',
      session: 's1',
      context: () => ({ trainer: 'KICKR' }),
      fetch: fetchImpl,
      now: () => Date.now(),
    });
    const add = (m: string, level: Level = 'info') => reporter.notify(buffer.add(m, level));
    return { buffer, reporter, add };
  };
  const ok = () => vi.fn(async () => new Response('{}', { status: 200 }));
  const callOf = (f: ReturnType<typeof ok>, call = 0) => (f.mock.calls as unknown as [string, RequestInit][])[call]!;
  const bodyOf = (f: ReturnType<typeof ok>, call = 0) => JSON.parse(callOf(f, call)[1].body as string);

  it("n'envoie rien tant qu'il n'y a pas d'erreur", async () => {
    const f = ok();
    const { add } = setup(f as unknown as typeof fetch);
    add('trainer : connecting');
    add('trainer : connected');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f).not.toHaveBeenCalled();
  });

  it("envoie, après le délai, l'erreur avec ce qui la précède et ce qui la suit", async () => {
    const f = ok();
    const { add } = setup(f as unknown as typeof fetch);
    add('GATT déconnecté');
    add('essai 1 échoué : Connection failed', 'error');
    await vi.advanceTimersByTimeAsync(2000);
    add('essai 2 échoué : Connection failed', 'error'); // arrive pendant l'attente : part dans le même rapport
    await vi.advanceTimersByTimeAsync(5000);

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = callOf(f);
    expect(url).toBe('https://logs.test/api/logs/ingest');
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok' });
    const body = bodyOf(f);
    expect(body).toMatchObject({ session: 's1', reason: 'error', context: { trainer: 'KICKR' } });
    expect(body.entries.map((e: { msg: string }) => e.msg)).toEqual([
      'GATT déconnecté',
      'essai 1 échoué : Connection failed',
      'essai 2 échoué : Connection failed',
    ]);
  });

  it('ne renvoie jamais une ligne déjà partie et espace les envois', async () => {
    const f = ok();
    const { add } = setup(f as unknown as typeof fetch);
    add('échec A', 'error');
    await vi.advanceTimersByTimeAsync(5000);
    add('échec B', 'error'); // 5 s après le premier envoi : attend l'écart minimal de 30 s
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 1).entries.map((e: { msg: string }) => e.msg)).toEqual(['échec B']);
  });

  it('garde ce qui n’est pas parti (hors ligne) et le renvoie avec retry', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const { add, reporter } = setup(f);
    add('échec de connexion : réseau', 'error');
    await vi.advanceTimersByTimeAsync(5000);
    expect(f).toHaveBeenCalledTimes(1);

    expect(await reporter.retry('online')).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    expect(await reporter.retry('online')).toBe(false); // plus rien à renvoyer
  });

  it('un refus du serveur ne lève rien', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response('{}', { status: 403 }));
    const { add, reporter } = setup(f);
    add('échec', 'error');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await reporter.flush('x')).toBe(false);
  });

  it('tient le corps sous la limite de keepalive en écartant les lignes les plus anciennes', async () => {
    const f = ok();
    const { add } = setup(f as unknown as typeof fetch);
    for (let i = 0; i < 300; i++) add(`${i} ${'x'.repeat(900)}`);
    add('échec final', 'error');
    await vi.advanceTimersByTimeAsync(5000);
    const body = callOf(f)[1].body as string;
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(JSON.parse(body).entries.at(-1).msg).toBe('échec final');
  });
});

describe('parseReport', () => {
  const valid = { session: 's', reason: 'error', context: { a: 1 }, entries: [{ n: 1, t: 1, level: 'error', msg: 'x' }] };

  it('accepte un rapport valide', () => expect(parseReport(valid)).toEqual(valid));

  it.each([
    ['sans session', { ...valid, session: '' }],
    ['niveau inconnu', { ...valid, entries: [{ n: 1, t: 1, level: 'debug', msg: 'x' }] }],
    ['message non texte', { ...valid, entries: [{ n: 1, t: 1, level: 'info', msg: 42 }] }],
    ['numéro NaN', { ...valid, entries: [{ n: NaN, t: 1, level: 'info', msg: 'x' }] }],
    ['trop de lignes', { ...valid, entries: Array.from({ length: 501 }, (_, n) => ({ n, t: 1, level: 'info', msg: 'x' })) }],
    ['contexte énorme', { ...valid, context: { big: 'x'.repeat(9000) } }],
    ['pas un objet', 'oups'],
  ])('refuse : %s', (_, v) => expect(parseReport(v)).toBeUndefined());

  it('coupe les messages trop longs', () => {
    const r = parseReport({ ...valid, entries: [{ n: 1, t: 1, level: 'info', msg: 'x'.repeat(5000) }] });
    expect(r!.entries[0]!.msg).toHaveLength(1000);
  });
});

describe('récepteur', () => {
  const memory = (): LogStore & { rows: StoredReport[] } => {
    const rows: StoredReport[] = [];
    return { rows, append: async (r) => void rows.push(r), read: async ({ limit }) => rows.slice(-limit) };
  };
  const report = { session: 's', reason: 'error', context: {}, entries: [{ n: 1, t: 1, level: 'error', msg: 'x' }] satisfies LogEntry[] };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('http://h/api/logs/ingest', { method: 'POST', body: JSON.stringify(body), headers });

  it("ignore les URL qui ne sont pas de son ressort", async () => {
    const r = createLogReceiver({ store: memory() });
    expect(await r(new Request('http://h/api/strava/status'))).toBeUndefined();
  });

  it('stocke un rapport valide avec la date de réception', async () => {
    const store = memory();
    const r = createLogReceiver({ store, now: () => 1234, allowOpenIngest: true });
    const res = (await r(post(report)))!;
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(store.rows).toEqual([{ ...report, receivedAt: 1234 }]);
  });

  it('répond au préambule CORS', async () => {
    const r = createLogReceiver({ store: memory() });
    const res = (await r(new Request('http://h/api/logs/ingest', { method: 'OPTIONS' })))!;
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it("exige le jeton d'envoi quand il est configuré", async () => {
    const store = memory();
    const r = createLogReceiver({ store, ingestToken: 'secret' });
    expect((await r(post(report)))!.status).toBe(403);
    expect((await r(post(report, { authorization: 'Bearer faux' })))!.status).toBe(403);
    expect((await r(post(report, { authorization: 'Bearer secret' })))!.status).toBe(200);
    expect(store.rows).toHaveLength(1);
  });

  it("refuse tout dépôt sans jeton configuré, sauf dépôt ouvert explicite", async () => {
    const store = memory();
    expect((await createLogReceiver({ store })(post(report)))!.status).toBe(503);
    expect(store.rows).toHaveLength(0);
  });

  it('refuse un corps annoncé trop gros avant de le lire', async () => {
    const r = createLogReceiver({ store: memory(), allowOpenIngest: true });
    expect((await r(post(report, { 'content-length': String(10 * 1024 * 1024) })))!.status).toBe(413);
  });

  it('refuse un rapport invalide ou trop gros', async () => {
    const r = createLogReceiver({ store: memory(), allowOpenIngest: true });
    expect((await r(post({ nimporte: 'quoi' })))!.status).toBe(400);
    expect((await r(new Request('http://h/api/logs/ingest', { method: 'POST', body: '{pas du json' })))!.status).toBe(400);
    expect((await r(post({ ...report, context: { x: 'y'.repeat(300_000) } })))!.status).toBe(413);
  });

  it('la lecture exige le jeton de lecture, et répond « non configuré » sans lui', async () => {
    const get = (headers: Record<string, string> = {}) => new Request('http://h/api/logs/reports?limit=5', { headers });

    expect((await createLogReceiver({ store: memory() })(get()))!.status).toBe(503);

    const store = memory();
    const r = createLogReceiver({ store, readToken: 'lire' });
    await store.append({ ...report, receivedAt: 1 });
    expect((await r(get()))!.status).toBe(403);
    expect((await r(get({ authorization: 'Bearer ingest' })))!.status).toBe(403);
    const ok = (await r(get({ authorization: 'Bearer lire' })))!;
    expect(ok.status).toBe(200);
    expect((await ok.json()).reports).toHaveLength(1);
  });
});
