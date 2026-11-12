import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { StoredReport } from '../src/telemetry/report.ts';
import { createD1Store, type D1Database } from './d1-store.ts';

/** D1 simulé avec le SQLite intégré à Node : exécute la vraie migration et le vrai SQL du magasin. */
function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./migrations/0001_init.sql', import.meta.url), 'utf8'));
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        run: async () => db.prepare(sql).run(...(values as never[])),
        all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
      }),
    }),
  };
}

const row = (receivedAt: number, session = 's'): StoredReport => ({
  session,
  reason: 'error',
  context: { trainer: 'KICKR' },
  entries: [{ n: 1, t: 1, level: 'error', msg: 'échec' }],
  receivedAt,
});

describe('magasin D1', () => {
  it('relit les rapports du plus ancien au plus récent, limités aux plus récents', async () => {
    const store = createD1Store(fakeD1());
    expect(await store.read({ limit: 10 })).toEqual([]);
    for (const t of [10, 20, 30, 40]) await store.append(row(t));
    expect((await store.read({ limit: 10 })).map((r) => r.receivedAt)).toEqual([10, 20, 30, 40]);
    expect((await store.read({ limit: 2 })).map((r) => r.receivedAt)).toEqual([30, 40]);
    expect((await store.read({ since: 20, limit: 10 })).map((r) => r.receivedAt)).toEqual([30, 40]);
  });

  it('rend le rapport tel qu’il a été déposé', async () => {
    const store = createD1Store(fakeD1());
    await store.append(row(5, 'abc'));
    expect(await store.read({ limit: 1 })).toEqual([row(5, 'abc')]);
  });

  it('purge les rapports plus vieux que la date donnée', async () => {
    const store = createD1Store(fakeD1());
    for (const t of [10, 20, 30]) await store.append(row(t));
    await store.purge(25);
    expect((await store.read({ limit: 10 })).map((r) => r.receivedAt)).toEqual([30]);
  });
});
