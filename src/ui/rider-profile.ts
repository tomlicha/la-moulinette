import { zoneRangesW } from '../workout/zones';

export const MASS_LIMITS = { min: 30, max: 200 } as const;
export const FTP_LIMITS = { min: 50, max: 600 } as const;

/** Rapport puissance / masse, à la française : « 2,95 ». */
export const wattsPerKg = (ftpW: number, massKg: number) => (ftpW / massKg).toFixed(2).replace('.', ',');

/** Ramène une saisie dans les bornes ; une saisie illisible redonne `fallback`. */
export function clampValue(raw: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

interface Field {
  input: HTMLInputElement;
  source: HTMLInputElement;
  min: number;
  max: number;
  step: number;
}

/**
 * Fiche du coureur (masse, FTP, zones de puissance), ouverte en touchant le médaillon du radar ou le résumé.
 * Les champs de la sortie (`#mass`, `#wo-ftp`) restent la source de vérité : la fiche les lit, les met à jour
 * et déclenche leur événement `change`, si bien que l'enregistrement et les rafraîchissements existants s'appliquent.
 */
export function setupRiderProfile(o: {
  massSource: HTMLInputElement;
  ftpSource: HTMLInputElement;
  readFtp: () => number;
  readMass: () => number;
  /** Éléments qui affichent le résumé « 78 kg · FTP 230 W · 2,95 W/kg ». */
  summary: HTMLElement;
  dialog: HTMLDialogElement;
  /** Ouvreurs : le bouton « Mon coureur » (le médaillon est branché par l'appelant via `open`). */
  openers: HTMLElement[];
}) {
  const d = o.dialog;
  const q = <T extends HTMLElement>(sel: string) => d.querySelector<T>(sel)!;
  const fields: Record<'mass' | 'ftp', Field> = {
    mass: { input: q('#rider-mass'), source: o.massSource, ...MASS_LIMITS, step: 1 },
    ftp: { input: q('#rider-ftp'), source: o.ftpSource, ...FTP_LIMITS, step: 5 },
  };
  const wkgOut = q('#rider-wkg');
  const zonesOut = q('#rider-zones');

  const refresh = () => {
    const mass = o.readMass();
    const ftp = o.readFtp();
    const w = wattsPerKg(ftp, mass);
    o.summary.textContent = `${mass} kg · FTP ${ftp} W · ${w} W/kg`;
    wkgOut.textContent = w;
    zonesOut.replaceChildren(
      ...zoneRangesW(ftp).map((z) => {
        const li = document.createElement('li');
        const range = z.fromW === undefined ? `jusqu’à ${z.toW} W` : z.toW === undefined ? `dès ${z.fromW} W` : `${z.fromW}–${z.toW} W`;
        li.innerHTML = `<i class="${z.id}"></i><span>${z.id.toUpperCase()} · ${z.name}</span><b>${range}</b>`;
        return li;
      }),
    );
  };

  /** Écrit la valeur dans le champ de la sortie et prévient ceux qui l'écoutent (enregistrement, profil de séance). */
  const commit = (f: Field, v: number) => {
    f.input.value = String(v);
    if (f.source.value !== String(v)) {
      f.source.value = String(v);
      f.source.dispatchEvent(new Event('change', { bubbles: true }));
    }
    refresh();
  };
  const read = (f: Field) => clampValue(Number(f.input.value), f.min, f.max, Number(f.source.value) || f.min);

  for (const [key, f] of Object.entries(fields) as ['mass' | 'ftp', Field][]) {
    f.input.addEventListener('change', () => commit(f, read(f)));
    // Pendant la frappe, on suit sans corriger (pas de saut du curseur) tant que la valeur est dans les bornes.
    f.input.addEventListener('input', () => {
      const n = Number(f.input.value);
      if (n >= f.min && n <= f.max) commit(f, Math.round(n));
    });
    d.querySelectorAll<HTMLButtonElement>(`[data-step="${key}"]`).forEach((b) =>
      b.addEventListener('click', () => commit(f, clampValue(read(f) + Number(b.dataset.dir) * f.step, f.min, f.max, f.min))),
    );
  }

  const sync = () => {
    fields.mass.input.value = String(o.readMass());
    fields.ftp.input.value = String(o.readFtp());
    // La masse se fige pendant une sortie (voir startRide) : la fiche suit.
    const locked = o.massSource.readOnly;
    fields.mass.input.disabled = locked;
    d.querySelectorAll<HTMLButtonElement>('[data-step="mass"]').forEach((b) => (b.disabled = locked));
    q('#rider-mass-note').hidden = !locked;
    refresh();
  };

  const open = () => {
    sync();
    if (!d.open) d.showModal();
    d.querySelector<HTMLInputElement>('#rider-ftp')?.focus();
  };
  for (const b of o.openers) b.addEventListener('click', open);
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  // Un clic sur le fond (hors de la carte) ferme la fiche.
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  // Les champs de la sortie peuvent changer ailleurs : le résumé suit.
  o.massSource.addEventListener('change', refresh);
  o.ftpSource.addEventListener('change', refresh);
  refresh();
  return { open, refresh };
}
