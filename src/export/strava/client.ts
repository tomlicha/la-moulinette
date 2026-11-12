import { CSRF_HEADER, PREFIX } from './relay';
import { errMsg } from '../../util/errors';

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athlete?: string;
}

export type SendResult =
  | { ok: true; activityUrl?: string; processing?: boolean }
  | { ok: false; reason: 'not_configured' | 'not_connected' | 'rejected' | 'error'; message: string };

type Fetch = typeof fetch;

export async function getStatus(f: Fetch = fetch): Promise<StravaStatus> {
  const res = await f(`${PREFIX}status`);
  if (!res.ok) throw new Error(`relais Strava indisponible (HTTP ${res.status})`);
  return (await res.json()) as StravaStatus;
}

/** Envoie le FIT au relais local, qui le dépose chez Strava. Ne lève jamais : l'échec est dans le résultat. */
export async function sendToStrava(
  fit: Uint8Array,
  meta: { name: string; externalId: string },
  f: Fetch = fetch,
): Promise<SendResult> {
  let res: Response;
  try {
    const q = new URLSearchParams(meta);
    res = await f(`${PREFIX}upload?${q}`, { method: 'POST', headers: { [CSRF_HEADER]: '1' }, body: fit as BodyInit });
  } catch (e) {
    return { ok: false, reason: 'error', message: `relais injoignable : ${errMsg(e)}` };
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    activityUrl?: string;
    activityId?: string;
  };
  if (res.status === 503) return { ok: false, reason: 'not_configured', message: 'Strava non configuré (voir .env.example)' };
  if (res.status === 401) return { ok: false, reason: 'not_connected', message: 'connexion Strava nécessaire' };
  if (!res.ok) return { ok: false, reason: 'error', message: body.message ?? body.error ?? `HTTP ${res.status}` };
  if (body.error) return { ok: false, reason: 'rejected', message: body.error };
  return { ok: true, activityUrl: body.activityUrl, processing: !body.activityId };
}

/** Attend la fin de la connexion dans la fenêtre ouverte par l'appelant (geste utilisateur synchrone). */
export function waitForLogin(win: Window, timeoutMs = 5 * 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearInterval(timer);
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(ok);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data === 'strava-connected') done(true);
    };
    window.addEventListener('message', onMessage);
    const timer = setInterval(() => win.closed && done(false), 500);
    const timeout = setTimeout(() => done(false), timeoutMs);
  });
}
