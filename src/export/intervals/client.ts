import { CSRF_HEADER } from '../strava/relay';
import { PREFIX } from './relay';

export interface IntervalsStatus {
  configured: boolean;
}

export type SendResult =
  | { ok: true; created: boolean; activityUrl?: string }
  | { ok: false; reason: 'not_configured' | 'invalid_key' | 'error'; message: string };

type Fetch = typeof fetch;

export async function getStatus(f: Fetch = fetch): Promise<IntervalsStatus> {
  const res = await f(`${PREFIX}status`);
  if (!res.ok) throw new Error(`relais intervals.icu indisponible (HTTP ${res.status})`);
  return (await res.json()) as IntervalsStatus;
}

/** Envoie le FIT au relais local, qui le dépose chez intervals.icu. Ne lève jamais : l'échec est dans le résultat. */
export async function sendToIntervals(
  fit: Uint8Array,
  meta: { name: string; externalId: string },
  f: Fetch = fetch,
): Promise<SendResult> {
  let res: Response;
  try {
    const q = new URLSearchParams(meta);
    res = await f(`${PREFIX}upload?${q}`, { method: 'POST', headers: { [CSRF_HEADER]: '1' }, body: fit as BodyInit });
  } catch (e) {
    return { ok: false, reason: 'error', message: `relais injoignable : ${e instanceof Error ? e.message : e}` };
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    created?: boolean;
    activityUrl?: string;
  };
  if (res.status === 503) return { ok: false, reason: 'not_configured', message: 'intervals.icu non configuré (voir .env.example)' };
  if (res.status === 401) return { ok: false, reason: 'invalid_key', message: "clé d'API intervals.icu refusée" };
  if (!res.ok) return { ok: false, reason: 'error', message: body.message ?? body.error ?? `HTTP ${res.status}` };
  return { ok: true, created: !!body.created, activityUrl: body.activityUrl };
}
