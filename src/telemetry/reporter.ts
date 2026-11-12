import type { LogBuffer } from './log-buffer';
import type { LogEntry, Report } from './report';

/** Sous la limite de 64 Ko des requêtes `keepalive`, avec de la marge pour les en-têtes. */
export const MAX_BODY_BYTES = 60 * 1024;

export interface ReporterOptions {
  endpoint: string;
  /** Jeton d'envoi (Authorization: Bearer). Il est dans le code de la page : il limite le bruit, il ne protège pas un secret. */
  token?: string;
  session: string;
  context?: () => Record<string, unknown>;
  fetch?: typeof fetch;
  now?: () => number;
  /** Attente après la première erreur, pour embarquer les lignes qui la suivent (essais de reconnexion…). */
  delayMs?: number;
  /** Écart minimal entre deux envois. */
  minIntervalMs?: number;
  /** Plafond d'envois par session. */
  maxReports?: number;
}

export interface Reporter {
  /** À appeler pour chaque ligne ajoutée au tampon. */
  notify(entry: LogEntry): void;
  /** Envoie maintenant ce qui n'est pas encore parti. Résout `true` si un rapport a été accepté. */
  flush(reason: string): Promise<boolean>;
  /** Renvoie ce qui n'a pas pu partir (hors ligne, serveur injoignable). */
  retry(reason: string): Promise<boolean>;
}

/**
 * Envoie le tampon au serveur dès qu'une erreur survient. Ne lève jamais et ne journalise jamais ses propres échecs :
 * un journal qui s'envoie en boucle à cause de lui-même serait pire que pas de journal.
 */
export function createReporter(buffer: LogBuffer, opts: ReporterOptions): Reporter {
  const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = opts.now ?? Date.now;
  const delayMs = opts.delayMs ?? 5000;
  const minIntervalMs = opts.minIntervalMs ?? 30_000;
  const maxReports = opts.maxReports ?? 20;

  let sentUpTo = 0;
  let sentCount = 0;
  let lastSentAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false; // une erreur n'est pas encore partie
  let inFlight = false;

  async function send(reason: string): Promise<boolean> {
    if (inFlight || sentCount >= maxReports) return false;
    const entries = buffer.since(sentUpTo);
    if (!entries.length) {
      pending = false;
      return false;
    }
    inFlight = true;
    try {
      const body = encode(reason, entries);
      const res = await f(opts.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
        body,
        keepalive: true,
      });
      if (!res.ok) return false;
      sentUpTo = entries[entries.length - 1]!.n;
      sentCount++;
      lastSentAt = now();
      pending = false;
      return true;
    } catch {
      return false;
    } finally {
      inFlight = false;
    }
  }

  /**
   * Corps du rapport, tenu sous `MAX_BODY_BYTES` : avec `keepalive`, le navigateur refuse un corps de plus de 64 Ko,
   * et le rapport ne partirait jamais. Les lignes les plus anciennes sont écartées d'abord : l'erreur est à la fin.
   */
  function encode(reason: string, entries: LogEntry[]): string {
    const context = opts.context?.() ?? {};
    let kept = entries;
    for (;;) {
      const report: Report = { session: opts.session, reason, context, entries: kept };
      const body = JSON.stringify(report);
      if (kept.length <= 1 || new TextEncoder().encode(body).length <= MAX_BODY_BYTES) return body;
      kept = kept.slice(Math.ceil(kept.length / 4));
    }
  }

  return {
    notify(entry) {
      if (entry.level !== 'error') return;
      pending = true;
      if (timer) return;
      const wait = Math.max(delayMs, lastSentAt + minIntervalMs - now());
      timer = setTimeout(() => {
        timer = undefined;
        void send('error');
      }, wait);
    },
    flush(reason) {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      return send(reason);
    },
    retry: (reason) => (pending && !timer ? send(reason) : Promise.resolve(false)),
  };
}
