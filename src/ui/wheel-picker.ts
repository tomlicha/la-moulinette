/** Hauteur d'une ligne de la roulette, en pixels : la même que dans home.css (`.wheel-item`). */
export const WHEEL_ROW_PX = 40;

/**
 * Valeurs proposées par la roulette, de `min` à `max` par pas de `step`. Si la valeur actuelle n'est pas sur la grille
 * (une FTP de 233 W avec un pas de 5), elle est ajoutée pour que la roulette s'ouvre exactement dessus.
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

export interface WheelRequest {
  title: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onPick: (value: number) => void;
}

/**
 * Roulette de chiffres en surimpression (une boîte de dialogue) : on fait défiler jusqu'à la valeur, qui s'accroche au
 * centre, puis on valide. Évite le clavier du téléphone, qui masque la moitié de l'écran.
 */
export function setupWheel(dialog: HTMLDialogElement) {
  const list = dialog.querySelector<HTMLElement>('#wheel')!;
  const title = dialog.querySelector<HTMLElement>('#wheel-title')!;
  const unit = dialog.querySelector<HTMLElement>('#wheel-unit')!;
  let values: number[] = [];
  let index = 0;
  let onPick: (v: number) => void = () => {};
  let frame = 0;

  const mark = (i: number) => {
    index = i;
    list.setAttribute('aria-activedescendant', `wheel-${i}`);
    list.querySelectorAll('[aria-selected="true"]').forEach((e) => e.setAttribute('aria-selected', 'false'));
    list.children[i]?.setAttribute('aria-selected', 'true');
  };
  const goTo = (i: number, smooth: boolean) => {
    const c = Math.min(values.length - 1, Math.max(0, i));
    list.scrollTo({ top: c * WHEEL_ROW_PX, behavior: smooth ? 'smooth' : 'instant' });
    mark(c);
  };

  list.addEventListener('scroll', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const i = Math.min(values.length - 1, Math.max(0, Math.round(list.scrollTop / WHEEL_ROW_PX)));
      if (i !== index) mark(i);
    });
  });
  list.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (item) goTo(Number(item.dataset.i), true);
  });
  list.addEventListener('keydown', (e) => {
    const jump = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[e.key];
    if (jump !== undefined) goTo(index + jump, true);
    else if (e.key === 'Home') goTo(0, true);
    else if (e.key === 'End') goTo(values.length - 1, true);
    else if (e.key === 'Enter') confirm();
    else return;
    e.preventDefault();
  });

  const confirm = () => {
    const v = values[index];
    dialog.close();
    if (v !== undefined) onPick(v);
  };
  dialog.querySelector('[data-wheel-ok]')!.addEventListener('click', confirm);
  dialog.querySelector('[data-wheel-cancel]')!.addEventListener('click', () => dialog.close());
  // Un appui sur le fond (hors de la carte) annule.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  return {
    open(r: WheelRequest) {
      values = wheelValues(r.min, r.max, r.step, r.value);
      onPick = r.onPick;
      title.textContent = r.title;
      unit.textContent = r.unit;
      list.replaceChildren(
        ...values.map((v, i) => {
          const li = document.createElement('div');
          li.className = 'wheel-item';
          li.id = `wheel-${i}`;
          li.dataset.i = String(i);
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', 'false');
          li.textContent = String(v);
          return li;
        }),
      );
      list.setAttribute('aria-label', `${r.title} en ${r.unit}`);
      dialog.showModal();
      goTo(Math.max(0, values.indexOf(r.value)), false);
      list.focus({ preventScroll: true });
    },
  };
}
