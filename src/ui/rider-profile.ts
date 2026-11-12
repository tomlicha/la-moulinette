import { zoneRangesW } from '../workout/zones';
import type { setupWheel } from './wheel-picker';

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
  /** Bouton qui affiche la valeur et ouvre la roulette. */
  button: HTMLButtonElement;
  source: HTMLInputElement;
  min: number;
  max: number;
  step: number;
  label: string;
  unit: string;
}

/**
 * Fiche du coureur (masse, FTP, zones de puissance), ouverte en touchant le médaillon du radar ou le résumé.
 * Les valeurs se choisissent sur une roulette de chiffres (voir wheel-picker.ts), jamais au clavier.
 * Les champs de la sortie (`#mass`, `#wo-ftp`) restent la source de vérité : la fiche les lit, les met à jour
 * et déclenche leur événement `change`, si bien que l'enregistrement et les rafraîchissements existants s'appliquent.
 */
export function setupRiderProfile(o: {
  massSource: HTMLInputElement;
  ftpSource: HTMLInputElement;
  readFtp: () => number;
  readMass: () => number;
  /** Élément qui affiche le résumé « 78 kg · FTP 230 W · 2,95 W/kg ». */
  summary: HTMLElement;
  dialog: HTMLDialogElement;
  wheel: ReturnType<typeof setupWheel>;
  /** Ouvreurs : le bouton « Mon coureur » (le médaillon est branché par l'appelant via `open`). */
  openers: HTMLElement[];
}) {
  const d = o.dialog;
  const q = <T extends HTMLElement>(sel: string) => d.querySelector<T>(sel)!;
  const fields: Record<'mass' | 'ftp', Field> = {
    mass: { button: q('#rider-mass'), source: o.massSource, ...MASS_LIMITS, step: 1, label: 'Masse', unit: 'kg' },
    ftp: { button: q('#rider-ftp'), source: o.ftpSource, ...FTP_LIMITS, step: 1, label: 'FTP', unit: 'W' },
  };
  const current = (k: 'mass' | 'ftp') => (k === 'mass' ? o.readMass() : o.readFtp());
  const wkgOut = q('#rider-wkg');
  const zonesOut = q('#rider-zones');

  const refresh = () => {
    const mass = o.readMass();
    const ftp = o.readFtp();
    const w = wattsPerKg(ftp, mass);
    o.summary.textContent = `${mass} kg · FTP ${ftp} W · ${w} W/kg`;
    wkgOut.textContent = w;
    fields.mass.button.textContent = String(mass);
    fields.ftp.button.textContent = String(ftp);
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
    if (f.source.value !== String(v)) {
      f.source.value = String(v);
      f.source.dispatchEvent(new Event('change', { bubbles: true }));
    }
    refresh();
  };

  for (const [key, f] of Object.entries(fields) as ['mass' | 'ftp', Field][]) {
    f.button.addEventListener('click', () =>
      o.wheel.open({ title: f.label, unit: f.unit, min: f.min, max: f.max, step: f.step, value: current(key), digits: key === 'ftp', onPick: (v) => commit(f, v) }),
    );
    d.querySelectorAll<HTMLButtonElement>(`[data-step="${key}"]`).forEach((b) =>
      b.addEventListener('click', () => commit(f, clampValue(current(key) + Number(b.dataset.dir) * f.step, f.min, f.max, f.min))),
    );
  }

  const sync = () => {
    // La masse se fige pendant une sortie (voir startRide) : la fiche suit.
    const locked = o.massSource.readOnly;
    fields.mass.button.disabled = locked;
    d.querySelectorAll<HTMLButtonElement>('[data-step="mass"]').forEach((b) => (b.disabled = locked));
    q('#rider-mass-note').hidden = !locked;
    refresh();
  };

  const open = () => {
    sync();
    if (!d.open) d.showModal();
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
