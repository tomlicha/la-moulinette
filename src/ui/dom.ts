/**
 * Élément de la page par identifiant. Absent, l'erreur nomme l'identifiant dès le démarrage, au lieu d'un
 * « Cannot read properties of null » plus tard, au premier clic.
 */
export function $<T extends Element = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`élément #${id} absent de la page`);
  return el as unknown as T;
}
