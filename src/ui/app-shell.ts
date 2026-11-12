/**
 * Comportement « application » sur mobile : plein écran, verrou en paysage, invitation à tourner l'appareil quand
 * le téléphone est tenu en portrait, et guide d'installation là où le plein écran n'existe pas autrement. Sur
 * ordinateur (pointeur précis), rien ne change.
 *
 * Deux chemins vers le plein écran :
 * - le navigateur le permet (Android, iPad, ordinateur) : `requestFullscreen` au premier toucher et sur le bouton ;
 * - il ne le permet pas (tous les navigateurs sur iPhone) : seule l'application lancée depuis l'écran d'accueil
 *   s'affiche sans barres. Le guide d'installation explique comment l'y ajouter ; il s'affiche à chaque lancement
 *   dans le navigateur, tant qu'on ne l'a pas écarté pour la session.
 */

/** Session en cours : le guide d'installation a été écarté (« Continuer dans le navigateur »). */
const SKIP_KEY = 'zwift2.installSkipped';

export function setupAppShell() {
  const touch = matchMedia('(pointer: coarse)');
  const portrait = matchMedia('(orientation: portrait)');
  const hint = document.getElementById('rotate-hint');
  const btn = document.getElementById('fs-btn') as HTMLButtonElement | null;
  const install = document.getElementById('install-hint');
  const skip = document.getElementById('install-skip');
  // `navigator.standalone` : seul signal fiable sur les anciens iOS, où `display-mode` n'est pas renseigné.
  const standalone = () =>
    matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const canFullscreen = !!document.documentElement.requestFullscreen;

  // Le stockage de session peut être refusé (navigation privée) : le choix vaut alors pour la page en cours.
  let skipped = false;
  try {
    skipped = sessionStorage.getItem(SKIP_KEY) === '1';
  } catch { /* stockage indisponible */ }
  const setSkipped = (on: boolean) => {
    skipped = on;
    try {
      if (on) sessionStorage.setItem(SKIP_KEY, '1');
      else sessionStorage.removeItem(SKIP_KEY);
    } catch { /* stockage indisponible */ }
  };

  /** Plein écran impossible depuis la page : il faut passer par l'écran d'accueil. */
  const installOnly = () => touch.matches && !canFullscreen && !standalone();

  const update = () => {
    const showInstall = installOnly() && !skipped;
    if (install) install.hidden = !showInstall;
    // Le guide d'installation passe avant l'invite à tourner : il se suit dans les deux orientations.
    if (hint) hint.hidden = !(touch.matches && portrait.matches) || showInstall;
    // Le bouton passe en plein écran là où c'est possible, et rouvre le guide d'installation ailleurs.
    const already = standalone() || !!document.fullscreenElement;
    if (btn) {
      btn.hidden = already;
      btn.textContent = canFullscreen ? 'Passer en plein écran' : 'Comment passer en plein écran';
    }
  };
  update();
  portrait.addEventListener('change', update);
  touch.addEventListener('change', update);
  document.addEventListener('fullscreenchange', update);

  const lockLandscape = () => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => {}); // refusé hors plein écran, ou non pris en charge (iOS)
  };

  const goFullscreen = async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch { /* refusé par le navigateur : l'application reste utilisable dans sa fenêtre */ }
    lockLandscape();
  };

  btn?.addEventListener('click', () => {
    if (canFullscreen) return void goFullscreen();
    setSkipped(false);
    update();
  });
  skip?.addEventListener('click', () => {
    setSkipped(true);
    update();
  });
  if (!touch.matches || standalone() || !canFullscreen) return;
  // Premier geste de l'utilisateur sur mobile : on passe en plein écran paysage.
  addEventListener('pointerup', () => void goFullscreen(), { once: true });
}
