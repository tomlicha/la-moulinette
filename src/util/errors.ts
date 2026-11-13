/** Message lisible d'une erreur quelconque (`Error`, chaîne, valeur rejetée…). */
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
