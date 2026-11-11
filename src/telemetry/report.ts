/** Format d'un rapport de journal, partagé entre l'application (émetteur) et le récepteur. */

export type Level = 'info' | 'error';

export interface LogEntry {
  /** Numéro d'ordre dans la session, croissant : sert à ne jamais renvoyer deux fois la même ligne. */
  n: number;
  /** Date (ms epoch). */
  t: number;
  level: Level;
  msg: string;
}

export interface Report {
  /** Identifiant tiré au hasard à chaque chargement de la page : regroupe les rapports d'une même session. */
  session: string;
  /** Pourquoi ce rapport part : « error », « online »… */
  reason: string;
  /** Environnement : navigateur, trainer, état de connexion… */
  context: Record<string, unknown>;
  entries: LogEntry[];
}

export interface StoredReport extends Report {
  /** Date de réception côté serveur (ms epoch). */
  receivedAt: number;
}

export const LIMITS = {
  bodyBytes: 256 * 1024,
  entries: 500,
  msgChars: 1000,
  contextBytes: 8 * 1024,
  stringChars: 64,
};

/** Valide et nettoie un corps JSON inconnu ; `undefined` s'il ne ressemble pas à un rapport. */
export function parseReport(raw: unknown): Report | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.session !== 'string' || !r.session || r.session.length > LIMITS.stringChars) return undefined;
  if (typeof r.reason !== 'string' || r.reason.length > LIMITS.stringChars) return undefined;
  if (!Array.isArray(r.entries) || r.entries.length > LIMITS.entries) return undefined;
  const context = r.context ?? {};
  if (typeof context !== 'object' || Array.isArray(context)) return undefined;
  if (JSON.stringify(context).length > LIMITS.contextBytes) return undefined;

  const entries: LogEntry[] = [];
  for (const e of r.entries) {
    if (!e || typeof e !== 'object') return undefined;
    const { n, t, level, msg } = e as Record<string, unknown>;
    if (typeof n !== 'number' || !Number.isFinite(n) || typeof t !== 'number' || !Number.isFinite(t)) return undefined;
    if (level !== 'info' && level !== 'error') return undefined;
    if (typeof msg !== 'string') return undefined;
    entries.push({ n, t, level, msg: msg.slice(0, LIMITS.msgChars) });
  }
  return { session: r.session, reason: r.reason, context: context as Record<string, unknown>, entries };
}
