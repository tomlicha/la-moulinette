/**
 * Boutons « indisponibles » qui expliquent pourquoi. Un bouton `disabled` est muet : ni clic, ni focus clavier,
 * et rien ne dit à l'utilisateur ce qu'on attend de lui. Ici le bouton reste survolable et activable, porte
 * `aria-disabled`, et son activation affiche la raison, avec au besoin une action qui débloque la situation.
 */
export interface BlockReason {
  text: string;
  action?: { label: string; run: () => void };
}

const reasons = new WeakMap<HTMLElement, BlockReason>();
const SELECTOR = '[aria-disabled="true"]';

let tip: HTMLElement | undefined;
let tipText: HTMLElement;
let tipAction: HTMLButtonElement;
let owner: HTMLElement | undefined;
/** Affichée par un clic : elle reste jusqu'à un clic ailleurs ou Échap, le temps de lire et d'utiliser l'action. */
let pinned = false;
/** Délai avant de cacher après un survol : laisse le temps d'amener la souris du bouton jusqu'à l'explication. */
let hideTimer: ReturnType<typeof setTimeout> | undefined;
const HIDE_DELAY_MS = 300;

/** Rend le bouton indisponible avec sa raison, ou de nouveau utilisable sans raison. */
export function setBlocked(el: HTMLButtonElement, reason?: string | BlockReason) {
  el.disabled = false; // un vrai `disabled` empêcherait de survoler et de cliquer pour comprendre
  if (!reason) {
    el.removeAttribute('aria-disabled');
    reasons.delete(el);
    if (owner === el) hide();
    return;
  }
  const r = typeof reason === 'string' ? { text: reason } : reason;
  el.setAttribute('aria-disabled', 'true');
  reasons.set(el, r);
  if (owner === el) fill(r); // raison changée pendant l'affichage
}

export const blockedReason = (el: HTMLElement) => reasons.get(el)?.text;

function fill(r: BlockReason) {
  tipText.textContent = r.text;
  tipAction.hidden = !r.action;
  tipAction.textContent = r.action?.label ?? '';
}

function show(el: HTMLElement, pin: boolean) {
  const r = reasons.get(el);
  if (!r || !tip) return;
  // Une boîte de dialogue modale passe au-dessus de tout le reste de la page : l'explication doit y entrer pour rester visible.
  const host = el.closest('dialog[open]') ?? document.body;
  if (tip.parentElement !== host) host.append(tip);
  owner?.removeAttribute('aria-describedby');
  owner = el;
  el.setAttribute('aria-describedby', tip.id);
  fill(r);
  tip.hidden = false;
  const b = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, b.left + b.width / 2 - w / 2))}px`;
  const below = b.bottom + 8 + tip.offsetHeight < innerHeight;
  tip.style.top = `${below ? b.bottom + 8 : b.top - tip.offsetHeight - 8}px`;
  pinned = pin;
  clearTimeout(hideTimer);
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => !pinned && hide(), HIDE_DELAY_MS);
}

function hide() {
  if (!tip) return;
  clearTimeout(hideTimer);
  tip.hidden = true;
  pinned = false;
  owner?.removeAttribute('aria-describedby');
  owner = undefined;
}

/** À appeler une fois au démarrage, avant tout autre écouteur de clic. */
export function setupBlockedHints() {
  tip = document.createElement('div');
  tip.id = 'blocked-tip';
  tip.className = 'blocked-tip';
  tip.setAttribute('role', 'status');
  tip.setAttribute('aria-live', 'polite');
  tip.hidden = true;
  tipText = document.createElement('span');
  tipAction = document.createElement('button');
  tipAction.type = 'button';
  tipAction.addEventListener('click', () => {
    const r = owner && reasons.get(owner);
    hide();
    r?.action?.run();
  });
  tip.append(tipText, tipAction);
  document.body.append(tip);

  // Phase de capture : on intercepte l'activation avant les écouteurs du bouton lui-même.
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(SELECTOR);
      if (el) {
        e.preventDefault();
        e.stopImmediatePropagation();
        show(el, true);
      } else if (pinned && !tip!.contains(e.target as Node)) {
        hide();
      }
    },
    true,
  );
  // Survol : l'explication suit le bouton survolé, et reste tant que la souris est sur le bouton OU sur elle.
  const insideTipOrOwner = (n: EventTarget | null) => n instanceof Node && (tip!.contains(n) || !!owner?.contains(n));
  document.addEventListener('mouseover', (e) => {
    if (insideTipOrOwner(e.target)) {
      clearTimeout(hideTimer);
      return;
    }
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(SELECTOR);
    if (el) show(el, false); // un autre bouton indisponible prend la place, même si la précédente était épinglée
  });
  document.addEventListener('mouseout', (e) => {
    if (!owner || pinned) return;
    if (insideTipOrOwner(e.target) && !insideTipOrOwner(e.relatedTarget)) scheduleHide();
  });
  document.addEventListener('focusin', (e) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(SELECTOR);
    if (el) show(el, false);
    else if (!pinned && !tip!.contains(e.target as Node)) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  addEventListener('scroll', () => !pinned && hide(), { passive: true });
}
