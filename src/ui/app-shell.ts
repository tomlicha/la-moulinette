/**
 * Comportement « application » sur mobile : plein écran, verrou en paysage, et invitation à tourner l'appareil
 * quand le téléphone est tenu en portrait. Sur ordinateur (pointeur précis), rien ne change.
 */
export function setupAppShell() {
  const touch = matchMedia('(pointer: coarse)');
  const portrait = matchMedia('(orientation: portrait)');
  const hint = document.getElementById('rotate-hint');
  const btn = document.getElementById('fs-btn') as HTMLButtonElement | null;
  const standalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;

  const update = () => {
    if (hint) hint.hidden = !(touch.matches && portrait.matches);
  };
  update();
  portrait.addEventListener('change', update);
  touch.addEventListener('change', update);

  const lockLandscape = () => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => {}); // refusé hors plein écran, ou non pris en charge (iOS)
  };

  const goFullscreen = async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch { /* non pris en charge (iOS Safari) : ajouter à l'écran d'accueil */ }
    lockLandscape();
  };

  btn?.addEventListener('click', goFullscreen);
  if (!touch.matches || standalone()) return;
  // Premier geste de l'utilisateur sur mobile : on passe en plein écran paysage.
  addEventListener('pointerup', () => void goFullscreen(), { once: true });
}
