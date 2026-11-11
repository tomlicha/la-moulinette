import type { LogBuffer } from './log-buffer';
import type { LogEntry, Report } from './report';

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
      const report: Report = { session: opts.session, reason, context: opts.context?.() ?? {}, entries };
      const res = await f(opts.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
        body: JSON.stringify(report),
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
