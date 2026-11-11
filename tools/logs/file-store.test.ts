import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoredReport } from '../../src/telemetry/report.ts';
import { createFileStore } from './file-store.ts';

describe('stockage en fichier', () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'zwift2-logs-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const row = (receivedAt: number): StoredReport => ({ session: 's', reason: 'error', context: {}, entries: [], receivedAt });

  it('relit ce qu’il a écrit, filtre par date et limite au plus récent', async () => {
    const store = createFileStore(join(dir, 'r.jsonl'));
    expect(await store.read({ limit: 10 })).toEqual([]); // fichier absent
    for (const t of [1, 2, 3, 4]) await store.append(row(t));
    expect((await store.read({ since: 1, limit: 10 })).map((r) => r.receivedAt)).toEqual([2, 3, 4]);
    expect((await store.read({ limit: 2 })).map((r) => r.receivedAt)).toEqual([3, 4]);
  });
});
