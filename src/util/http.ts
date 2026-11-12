/** Outils des gestionnaires `Request` vers `Response` (relais Strava et intervals.icu, récepteur de journaux). */

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

/** Requête sans en-tête `Origin` (navigation, outil en ligne de commande) ou venue de la même origine que le serveur. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false; // `Origin: null` ou valeur illisible
  }
}

/** Échappe un texte destiné à une page HTML. */
export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
