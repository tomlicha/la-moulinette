/**
 * Client minimal de l'API intervals.icu : dépôt d'un fichier d'activité avec la clé d'API personnelle.
 * Tout passe par un `fetch` injecté : aucun appel réseau implicite, testable sans réseau.
 * Documentation : https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090
 */
export const INTERVALS_API = 'https://intervals.icu/api/v1';
export const INTERVALS_SITE = 'https://intervals.icu';

export type Fetch = typeof fetch;

export class IntervalsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface UploadMeta {
  name: string;
  description?: string;
  /** Identifiant unique côté client. */
  externalId: string;
}

export interface UploadResult {
  /** Une activité a été créée (201). Sinon (200) le fichier existait déjà : intervals.icu écarte les doublons. */
  created: boolean;
  activityId?: string;
}

/** Authentification basique : l'identifiant est le mot littéral `API_KEY`, le mot de passe est la clé. */
export const basicAuth = (apiKey: string) => `Basic ${btoa(`API_KEY:${apiKey}`)}`;

export async function uploadActivity(apiKey: string, fit: Uint8Array, meta: UploadMeta, f: Fetch): Promise<UploadResult> {
  const form = new FormData();
  form.set('file', new Blob([fit as BlobPart], { type: 'application/octet-stream' }), `${meta.externalId}.fit`);
  const q = new URLSearchParams({ name: meta.name, external_id: meta.externalId });
  if (meta.description) q.set('description', meta.description);

  // `0` désigne l'athlète propriétaire de la clé.
  const res = await f(`${INTERVALS_API}/athlete/0/activities?${q}`, {
    method: 'POST',
    headers: { Authorization: basicAuth(apiKey) },
    body: form,
  });
  if (res.status === 401 || res.status === 403) throw new IntervalsError('Clé intervals.icu refusée', res.status);
  if (!res.ok) throw new IntervalsError(`Dépôt refusé (HTTP ${res.status})`, res.status);

  // La réponse est une liste de références d'activité ; sa forme exacte n'est pas détaillée dans la documentation.
  const body: unknown = await res.json().catch(() => undefined);
  const first = Array.isArray(body) ? body[0] : body;
  const id = (first as { id?: string | number } | undefined)?.id;
  return { created: res.status === 201, activityId: id === undefined ? undefined : String(id) };
}
