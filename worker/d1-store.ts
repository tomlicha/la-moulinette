import type { LogStore } from '../src/telemetry/receiver.ts';
import type { StoredReport } from '../src/telemetry/report.ts';

/** Ce que ce module utilise de D1 : de quoi le simuler dans les tests sans dépendre des types de Cloudflare. */
export interface D1Database {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
}

export const RETENTION_MS = 30 * 24 * 3600 * 1000;

export function createD1Store(db: D1Database): LogStore & { purge(olderThan: number): Promise<void> } {
  return {
    async append(r: StoredReport) {
      await db
        .prepare('INSERT INTO reports (received_at, session, body) VALUES (?, ?, ?)')
        .bind(r.receivedAt, r.session, JSON.stringify(r))
        .run();
    },
    async read({ since = 0, limit }) {
      // Les `limit` plus récents, rendus du plus ancien au plus récent comme le stockage en fichier.
      const { results } = await db
        .prepare('SELECT body FROM reports WHERE received_at > ? ORDER BY received_at DESC, id DESC LIMIT ?')
        .bind(since, limit)
        .all<{ body: string }>();
      return results.map((row) => JSON.parse(row.body) as StoredReport).reverse();
    },
    async purge(olderThan) {
      await db.prepare('DELETE FROM reports WHERE received_at < ?').bind(olderThan).run();
    },
  };
}
