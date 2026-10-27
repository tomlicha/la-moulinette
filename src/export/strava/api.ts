/**
 * Client minimal de l'API Strava (v3) : OAuth 2 et dépôt de fichiers FIT.
 * Tout passe par un `fetch` injecté : aucun appel réseau implicite, testable sans réseau.
 * Documentation : https://developers.strava.com/docs/authentication/ et /docs/uploads/
 */
export const STRAVA_OAUTH = 'https://www.strava.com/oauth';
export const STRAVA_API = 'https://www.strava.com/api/v3';

export type Fetch = typeof fetch;

export interface ClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Expiration du jeton d'accès, en secondes epoch. Il vit 6 h. */
  expiresAt: number;
  athlete?: string;
}

export class StravaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:write',
    state,
  });
  return `${STRAVA_OAUTH}/authorize?${q}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { firstname?: string; lastname?: string };
}

async function tokenRequest(cfg: ClientConfig, params: Record<string, string>, f: Fetch): Promise<Tokens> {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params });
  const res = await f(`${STRAVA_OAUTH}/token`, { method: 'POST', body });
  if (!res.ok) throw new StravaError(`Strava a refusé l'échange de jeton (HTTP ${res.status})`, res.status);
  const j = (await res.json()) as TokenResponse;
  const name = [j.athlete?.firstname, j.athlete?.lastname].filter(Boolean).join(' ');
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: j.expires_at,
    athlete: name || undefined,
  };
}

export const exchangeCode = (cfg: ClientConfig, code: string, f: Fetch) =>
  tokenRequest(cfg, { grant_type: 'authorization_code', code }, f);

/** Le jeton de rafraîchissement tourne : l'ancien est invalidé dès qu'un nouveau est émis, il faut donc sauvegarder le résultat. */
export const refreshTokens = (cfg: ClientConfig, refreshToken: string, f: Fetch) =>
  tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken }, f);

export interface UploadStatus {
  id: string;
  activityId?: string;
  /** Message d'erreur de Strava (peut contenir du HTML échappé : à afficher comme texte, jamais comme HTML). */
  error?: string;
  status: string;
}

interface UploadResponse {
  id_str?: string;
  id?: number;
  activity_id?: number | null;
  activity_id_str?: string | null;
  error?: string | null;
  status?: string;
}

function toStatus(j: UploadResponse): UploadStatus {
  return {
    id: j.id_str ?? String(j.id ?? ''),
    activityId: j.activity_id_str ?? (j.activity_id ? String(j.activity_id) : undefined),
    error: j.error || undefined,
    status: j.status ?? '',
  };
}

export interface UploadMeta {
  name: string;
  description?: string;
  /** Identifiant unique côté client : Strava s'en sert pour détecter les doublons. */
  externalId: string;
}

export async function uploadFit(accessToken: string, fit: Uint8Array, meta: UploadMeta, f: Fetch): Promise<UploadStatus> {
  const form = new FormData();
  form.set('file', new Blob([fit as BlobPart], { type: 'application/octet-stream' }), `${meta.externalId}.fit`);
  form.set('data_type', 'fit');
  form.set('sport_type', 'VirtualRide');
  form.set('trainer', '1');
  form.set('name', meta.name);
  form.set('external_id', meta.externalId);
  if (meta.description) form.set('description', meta.description);

  const res = await f(`${STRAVA_API}/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (res.status === 401) throw new StravaError('Jeton Strava refusé', 401);
  const j = (await res.json().catch(() => ({}))) as UploadResponse;
  if (!res.ok && !j.error) throw new StravaError(`Dépôt refusé (HTTP ${res.status})`, res.status);
  return toStatus(j);
}

export async function uploadStatus(accessToken: string, id: string, f: Fetch): Promise<UploadStatus> {
  const res = await f(`${STRAVA_API}/uploads/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new StravaError('Jeton Strava refusé', 401);
  if (!res.ok) throw new StravaError(`Suivi du dépôt impossible (HTTP ${res.status})`, res.status);
  return toStatus((await res.json()) as UploadResponse);
}

/** Interroge le dépôt jusqu'à l'activité créée ou une erreur ; Strava recommande au plus une requête par seconde. */
export async function waitForUpload(
  accessToken: string,
  first: UploadStatus,
  f: Fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxPolls = 10,
): Promise<UploadStatus> {
  let cur = first;
  for (let i = 0; i < maxPolls && !cur.activityId && !cur.error; i++) {
    await sleep(1000);
    cur = await uploadStatus(accessToken, cur.id, f);
  }
  return cur;
}
