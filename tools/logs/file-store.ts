import { appendFile, readFile, rename, stat } from 'node:fs/promises';
import type { LogStore } from '../../src/telemetry/receiver.ts';
import type { StoredReport } from '../../src/telemetry/report.ts';

const MAX_BYTES = 5 * 1024 * 1024;

/** Un rapport par ligne (JSONL). Au-delà de 5 Mo, le fichier passe en `.1` (une seule génération gardée). */
export function createFileStore(path: string): LogStore {
  return {
    async append(report) {
      const size = await stat(path).then(
        (s) => s.size,
        () => 0,
      );
      if (size > MAX_BYTES) await rename(path, `${path}.1`);
      await appendFile(path, `${JSON.stringify(report)}\n`, 'utf8');
    },
    async read({ since = 0, limit }) {
      const text = await readFile(path, 'utf8').catch(() => '');
      const out: StoredReport[] = [];
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const r = JSON.parse(line) as StoredReport;
          if (r.receivedAt > since) out.push(r);
        } catch {
          // ligne tronquée par un arrêt brutal : on l'ignore
        }
      }
      return out.slice(-limit);
    },
  };
}
