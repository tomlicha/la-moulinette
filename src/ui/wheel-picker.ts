/** Hauteur d'une ligne de la roulette, en pixels : la même que dans home.css (`.wheel-item`). */
export const WHEEL_ROW_PX = 40;

/**
 * Valeurs proposées par une roulette simple, de `min` à `max` par pas de `step`. Si la valeur actuelle n'est pas sur la
 * grille, elle est ajoutée pour que la roulette s'ouvre exactement dessus.
 */
export function wheelValues(min: number, max: number, step: number, current: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max; v += step) out.push(v);
  if (current >= min && current <= max && !out.includes(current)) {
    out.push(current);
    out.sort((a, b) => a - b);
  }
  return out;
}

/** Les trois chiffres d'une valeur : centaines, dizaines, unités (230 donne 2, 3, 0). */
export function splitDigits(value: number): [number, number, number] {
  const v = Math.max(0, Math.round(value));
  return [Math.floor(v / 100) % 10, Math.floor(v / 10) % 10, v % 10];
}

export const joinDigits = (d: readonly number[]) => d[0]! * 100 + d[1]! * 10 + d[2]!;

export const clampTo = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface WheelRequest {
  title: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  onPick: (value: number) => void;
  /** Pas de la roulette unique ; sans objet avec `digits`. */
  step?: number;
  /** Trois roulettes, centaines, dizaines et unités : on compose la valeur chiffre par chiffre, de 1 en 1. */
  digits?: boolean;
}

interface Column {
  el: HTMLElement;
  values: number[];
  index: number;
}

/** Noms des colonnes pour les lecteurs d'écran seulement : l'ordre des chiffres est évident à l'écran. */
const DIGIT_NAMES = ['centaines', 'dizaines', 'unités'];

/**
 * Roulettes de chiffres en surimpression (une boîte de dialogue) : on fait défiler jusqu'à la valeur, qui s'accroche au
 * centre, puis on valide. Évite le clavier du téléphone, qui masque la moitié de l'écran. Une roulette simple pour la
 * masse, trois roulettes (centaines, dizaines, unités) pour la FTP.
 */
export function setupWheel(dialog: HTMLDialogElement) {
  const holder = dialog.querySelector<HTMLElement>('#wheel-cols')!;
  const title = dialog.querySelector<HTMLElement>('#wheel-title')!;
  const unit = dialog.querySelector<HTMLElement>('#wheel-unit')!;
  let cols: Column[] = [];
  let req: WheelRequest;
  let settle = 0;

  const read = () => (req.digits ? joinDigits(cols.map((c) => c.values[c.index]!)) : cols[0]!.values[cols[0]!.index]!);

  const mark = (c: Column, i: number) => {
    c.index = i;
    c.el.querySelectorAll('[aria-selected="true"]').forEach((e) => e.setAttribute('aria-selected', 'false'));
    c.el.children[i]?.setAttribute('aria-selected', 'true');
    c.el.setAttribute('aria-activedescendant', c.el.children[i]?.id ?? '');
  };
  const goTo = (c: Column, i: number, smooth: boolean) => {
    const n = Math.min(c.values.length - 1, Math.max(0, i));
    c.el.scrollTo({ top: n * WHEEL_ROW_PX, behavior: smooth ? 'smooth' : 'instant' });
    mark(c, n);
  };
  /** Trois chiffres peuvent composer une valeur hors bornes (une FTP de 799 W) : on ramène les roulettes dans les bornes. */
  const keepInRange = () => {
    if (!req.digits) return;
    const v = read();
    const c = clampTo(v, req.min, req.max);
    if (c !== v) splitDigits(c).forEach((d, k) => goTo(cols[k]!, cols[k]!.values.indexOf(d), true));
  };

  const build = (c: Column, k: number) => {
    c.el.className = 'wheel';
    c.el.tabIndex = 0;
    c.el.setAttribute('role', 'listbox');
    c.el.setAttribute('aria-label', req.digits ? `${req.title}, ${DIGIT_NAMES[k]}` : `${req.title} en ${req.unit}`);
    c.el.replaceChildren(
      ...c.values.map((v, i) => {
        const li = document.createElement('div');
        li.className = 'wheel-item';
        li.id = `wheel-${k}-${i}`;
        li.dataset.i = String(i);
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.textContent = String(v);
        return li;
      }),
    );
    let frame = 0;
    c.el.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const i = Math.min(c.values.length - 1, Math.max(0, Math.round(c.el.scrollTop / WHEEL_ROW_PX)));
        if (i !== c.index) mark(c, i);
        clearTimeout(settle);
        settle = window.setTimeout(keepInRange, 160);
      });
    });
    c.el.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (item) {
        goTo(c, Number(item.dataset.i), true);
        clearTimeout(settle);
        settle = window.setTimeout(keepInRange, 400);
      }
    });
    c.el.addEventListener('keydown', (e) => {
      const jump = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[e.key];
      if (jump !== undefined) goTo(c, c.index + jump, true);
      else if (e.key === 'Home') goTo(c, 0, true);
      else if (e.key === 'End') goTo(c, c.values.length - 1, true);
      else if (e.key === 'Enter') confirm();
      else return;
      e.preventDefault();
      clearTimeout(settle);
      settle = window.setTimeout(keepInRange, 400);
    });
  };

  const confirm = () => {
    const v = clampTo(read(), req.min, req.max);
    dialog.close();
    req.onPick(v);
  };
  dialog.querySelector('[data-wheel-ok]')!.addEventListener('click', confirm);
  dialog.querySelector('[data-wheel-cancel]')!.addEventListener('click', () => dialog.close());
  // Un appui sur le fond (hors de la carte) annule.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => clearTimeout(settle));

  return {
    open(r: WheelRequest) {
      req = r;
      title.textContent = r.title;
      unit.textContent = r.unit;
      holder.classList.toggle('wheel-cols--digits', !!r.digits);
      const digitSets = [Array.from({ length: Math.floor(r.max / 100) + 1 }, (_, i) => i), range10(), range10()];
      cols = r.digits
        ? digitSets.map((values) => ({ el: document.createElement('div'), values, index: 0 }))
        : [{ el: document.createElement('div'), values: wheelValues(r.min, r.max, r.step ?? 1, r.value), index: 0 }];
      cols.forEach(build);
      holder.replaceChildren(...cols.map((c) => c.el));
      dialog.showModal();
      const start = r.digits ? splitDigits(r.value) : [r.value];
      cols.forEach((c, k) => goTo(c, Math.max(0, c.values.indexOf(start[k]!)), false));
      cols[0]!.el.focus({ preventScroll: true });
    },
  };
}

const range10 = () => Array.from({ length: 10 }, (_, i) => i);
