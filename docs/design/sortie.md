# Écran Sortie

Référence permanente de l'écran **Sortie** : le rendu 3D en plein écran, le HUD par-dessus, et un menu contextuel pour tout le reste. Toute évolution part de ce fichier et le met à jour. Le HUD a sa propre référence : [hud.md](hud.md).

- Code : [`src/ui/sortie.css`](../../src/ui/sortie.css) (plein écran, bouton et feuille du menu), [`src/ui/ride-menu.ts`](../../src/ui/ride-menu.ts) (ouverture, fermeture, statistiques de rendu), balisage dans [`index.html`](../../index.html) (`data-view="sortie"`), branchement dans [`src/main.ts`](../../src/main.ts).

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-12 | La Sortie est **plein écran** comme les trois autres : le canevas 3D occupe toute la fenêtre (`position: fixed`, sans défilement), le HUD est posé dessus. La barre du haut (marque, navigation, pastilles d'état) disparaît, et avec elle les règles CSS propres à la Sortie. | C'était le dernier écran à garder l'ancienne mise en page en colonne de 1280 px avec une barre en haut. Le canevas n'est plus figé en 16:9 : la caméra suit la forme de la fenêtre. |
| 2026-11-12 | Le HUD garde sa scène de référence 1280 × 720, mais elle est **ajustée à la fenêtre (le plus grand 16:9 qui y tient) et centrée**, au lieu de suivre la largeur d'un bloc 16:9. | Sur une fenêtre plus large ou plus haute que 16:9, les panneaux restent proportionnés et lisibles au lieu d'être rognés ou étirés. |
| 2026-11-12 | Tout ce qui n'est pas la vue passe dans un **menu contextuel** : une feuille à droite (boîte de dialogue modale, Échap ou toucher à côté pour fermer), ouverte par un bouton en verre sombre en haut à droite, coin libre du HUD. La sortie continue derrière. | Les commandes ne sont utiles qu'à l'arrêt ou entre deux efforts ; sans elles, la vue est entière. Une boîte native donne gratuitement le piégeage du focus et la fermeture à Échap. |
| 2026-11-12 | **Supprimé, car couvert ailleurs** : la barre du haut et ses pastilles trainer / cardio (le HUD affiche les deux points d'état, l'écran Appareils le détail) ; le choix de la séance et la FTP (accueil, écran Séances, fiche du coureur) ; la masse (fiche du coureur) ; le titre « Sortie virtuelle » ; le profil, le nom et « Ensuite » de la séance (HUD). | Chaque information avait déjà sa place ailleurs ; les redoubler allongeait la page. |
| 2026-11-12 | **Gardé dans le menu** : navigation vers les autres écrans (la pastille flottante du bas recouvrirait le HUD) ; démarrer et arrêter la sortie ; démarrer la séance, pause, palier suivant, arrêt, intensité ± 5 % ; pilotage manuel ERG et SIM ; export FIT, Strava, intervals.icu ; rendu 3D (statistiques, WebGL2, qualité réduite) ; journal et « Copier le journal ». | Aucun de ces gestes n'existe ailleurs. Pilotage manuel, rendu et journal sont repliés : ils servent peu. |
| 2026-11-12 | Les **messages de la séance** (consignes écrites dans le fichier) sortent du bandeau sous la vue et s'affichent dans le HUD, sous le panneau central. | Le bandeau disparaissait avec les commandes ; la consigne doit rester sous les yeux. |
| 2026-11-12 | Le compteur de **statistiques de rendu** est masqué par défaut ; un interrupteur du menu (section « Affichage ») l'affiche, et le choix est mémorisé (`zwift2.viewStats`). | Une ligne de mesures sur la vue n'a rien à faire devant le coureur ; elle reste à un geste pour la mesure de performance. |
| 2026-11-12 | **Démarrage au premier coup de pédale** : sur l'écran Sortie, la première puissance ou cadence supérieure à zéro démarre la séance chargée (et la sortie qui la porte) ; sans séance chargée, ou si le trainer ne pilote pas l'ERG, elle démarre la sortie libre. Le démarrage est armé en arrivant sur l'écran ou en choisissant une séance, seulement si rien ne tourne ; il est désarmé dès qu'une sortie ou une séance démarre. | Plus besoin de passer par le menu pour rouler. Le désarmement évite qu'un arrêt volontaire soit défait par le pédalage qui continue, et qu'un retour sur l'écran en pleine sortie lance une séance. Logique : `maybeAutoStart` dans [`src/main.ts`](../../src/main.ts). |
| 2026-11-12 | Le bandeau « Aucun trainer connecté » devient un message en tête du menu, avec le lien vers Appareils ; une **pastille** sur le bouton du menu signale l'absence de trainer. | Le bandeau flottait au-dessus de la vue ; la pastille garde l'information visible sans masquer la scène. |

## Mise en page

- `[data-view='sortie']` est fixe sur toute la fenêtre ; `html` et `body` ne défilent plus sur cet écran. Les zones sûres (encoche, barre de gestes) sont respectées par le HUD et les boutons ; le canevas va jusqu'au bord.
- Haut droit : bouton du menu (44 px, 40 px en téléphone paysage), puis, si la case est cochée, les statistiques de rendu. La liste du groupe (multijoueur, prévue au HUD) viendra dessous.
- Téléphone en paysage : la feuille se resserre (360 px au plus, 62 % de la largeur) et défile.

## Menu contextuel

De haut en bas : navigation (Accueil, Séances, Appareils) ; message « pas de trainer » si besoin ; **Sortie** (démarrer / arrêter) ; **Séance** (nom de la séance choisie ; « Démarrer » avant, pause, palier suivant, arrêter et intensité pendant) ; **Enregistrement** ; **Affichage** (interrupteur des statistiques de rendu) ; puis les rubriques repliées **Pilotage manuel**, **Moteur de rendu** (WebGL2, WebGPU, qualité réduite) et **Journal**.

Les boutons indisponibles gardent leur explication au clic ([`blocked.ts`](../../src/ui/blocked.ts)) ; l'explication est montée dans la boîte ouverte, sans quoi elle passerait derrière.

Naviguer vers un autre écran ferme le menu (le routeur appelle `rideMenu.close()`) : une boîte modale laissée ouverte dans un écran masqué bloquerait toute la page.

## Données

- **Masse et FTP** : `#mass` et `#wo-ftp` restent la source de vérité du coureur, mais ce sont désormais des champs **cachés** de l'écran Sortie ; la fiche du coureur (écran Appareils) les lit et les met à jour.
- **Séance choisie** : le sélecteur de l'accueil (`#home-wo-select`) est le seul ; le menu de la sortie ne fait que la dérouler.

## À faire

- Vérifier le coût du plein écran sur un grand écran (4K, ratio de pixels 2) : `renderer.setPixelRatio` est limité à 2, `?quality=low` le ramène à 1.
- Dire à l'écran, avant le départ, que le premier coup de pédale démarre (la séance ou la sortie) ; aujourd'hui le HUD reste en tirets sans l'indiquer.
