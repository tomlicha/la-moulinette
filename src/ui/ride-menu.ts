import './sortie.css';

const STATS_KEY = 'zwift2.viewStats';

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/**
 * Menu contextuel de l'écran Sortie (docs/design/sortie.md) : une boîte de dialogue modale, ouverte par le bouton en haut
 * à droite. La sortie continue derrière. Les commandes qu'elle contient (sortie, séance, pilotage, export, journal) sont
 * branchées ailleurs, par leurs identifiants ; ce module ne gère que l'ouverture, la fermeture et les statistiques de rendu.
 */
export function setupRideMenu(o: { prefs: Store; opener: HTMLButtonElement; dialog: HTMLDialogElement; stats: HTMLElement }) {
  const { opener, dialog, stats } = o;
  const close = () => {
    if (dialog.open) dialog.close();
  };
  opener.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
  });
  dialog.querySelector('#ride-menu-close')?.addEventListener('click', close);
  // Toucher à côté de la feuille (sur le voile) la ferme ; un clic dans la feuille a pour cible un de ses éléments.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  // Statistiques de rendu : un relevé pour qui mesure les performances, masqué par défaut pour laisser la vue libre.
  const toggle = dialog.querySelector<HTMLInputElement>('#view-stats-toggle')!;
  let on = false;
  try {
    on = o.prefs.getItem(STATS_KEY) === '1';
  } catch {
    // préférence illisible : masqué
  }
  const apply = () => {
    toggle.checked = on;
    stats.hidden = !on;
  };
  toggle.addEventListener('change', () => {
    on = toggle.checked;
    apply();
    try {
      o.prefs.setItem(STATS_KEY, on ? '1' : '0');
    } catch {
      // préférence non mémorisée, sans conséquence
    }
  });
  apply();

  return {
    /** À appeler en quittant l'écran : une boîte modale restée ouverte dans un écran masqué bloquerait toute la page. */
    close,
    /** Pastille sur le bouton : quelque chose à voir dans le menu (trainer absent). */
    setAlert(alert: boolean) {
      if (alert) opener.dataset.alert = '';
      else delete opener.dataset.alert;
    },
  };
}
