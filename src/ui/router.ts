export type View = 'appareils' | 'sortie' | 'seances';
const VIEWS: View[] = ['appareils', 'sortie', 'seances'];

/**
 * Trois écrans dans une seule page, choisis par l'ancre de l'URL. Une page rechargée perd ses connexions
 * Bluetooth : l'application repart donc toujours de l'écran des appareils.
 */
export function setupRouter(onChange: (v: View) => void) {
  const current = (): View => {
    const v = location.hash.slice(1) as View;
    return VIEWS.includes(v) ? v : 'appareils';
  };
  const apply = () => {
    const v = current();
    document.querySelectorAll<HTMLElement>('[data-view]').forEach((el) => (el.hidden = el.dataset.view !== v));
    document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((a) => {
      if (a.dataset.nav === v) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    onChange(v);
  };
  history.replaceState(null, '', '#appareils');
  addEventListener('hashchange', apply);
  apply();
  return {
    current,
    go: (v: View) => {
      if (current() === v) apply();
      else location.hash = v;
    },
  };
}
