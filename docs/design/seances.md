# Écran Séances

Référence permanente de l'écran **Séances** : bibliothèque et éditeur sur un seul écran plein écran, dans la continuité de l'accueil. Toute évolution part de ce fichier et le met à jour.

- Code : [`src/ui/workout-editor.ts`](../../src/ui/workout-editor.ts) (bibliothèque et éditeur), [`src/ui/seances.css`](../../src/ui/seances.css) (style), balisage dans [`index.html`](../../index.html) (`data-view="seances"`), branchement dans [`src/main.ts`](../../src/main.ts) (`setupWorkoutEditor`).
- Logique pure, testée : [`src/workout/`](../../src/workout/) (`blocks.ts`, `block-ops.ts`, `history.ts`, `zones.ts`, `library.ts`), inchangée par la refonte.
- Maquettes (claude.ai), dans l'ordre : [tour 1, propositions A, B, C](https://claude.ai/artifact/2EYqkdcgcbfVNsmUkBJfLr) ; [tour 2, fusions D, E, F](https://claude.ai/artifact/9RCni2a8hDKeM26PUyM62Y) ; [tour 3, téléphone en paysage, G, H, I](https://claude.ai/artifact/TDiP7b83DzsLPigxce9kPE). Retenue pour l'ordinateur : **D · Miroir de l'accueil**. Pour le téléphone : choix en attente (voir « Téléphone en paysage »).

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-12 | Un seul écran pour la bibliothèque et l'éditeur, plein écran comme l'accueil (scène derrière, panneaux de verre, menthe, Barlow). Plus de page « liste » puis d'éditeur caché. | Choisir une séance sur l'accueil et la créer sur l'écran Séances étaient deux endroits ; l'éditeur restait invisible tant qu'on n'avait rien ouvert. |
| 2026-11-12 | Proposition **B** (accueil d'une séance : titre géant, Rouler) fusionnée avec l'édition tout-en-un de **C** (plus de bascule Modifier / Terminé) et la bibliothèque complète ; variante **D · Miroir de l'accueil** retenue face à E (étagère en bas) et F (rail de vignettes, dock). | D reprend la grille de l'accueil à l'identique : titre et Rouler en bas à gauche, colonne de verre à droite, navigation en haut à droite. C'est la moins coûteuse et la plus familière. |
| 2026-11-12 | Choisir une séance dans la bibliothèque l'**ouvre aussitôt** dans l'éditeur et en fait la séance choisie de l'application (accueil, sortie). À l'arrivée sur l'écran, on ouvre la séance choisie, sauf si un brouillon modifié est en cours. | Une seule séance « courante » dans toute l'application. |
| 2026-11-12 | Un **modèle** s'ouvre en lecture seule (on peut le parcourir et le rouler) ; « Dupliquer pour modifier » en fait une copie non enregistrée. | On ne modifie jamais un modèle livré avec l'application. |
| 2026-11-12 | **Rouler** enregistre la séance si besoin, la choisit, va sur la sortie et la démarre. Il attend un trainer connecté avec ERG, comme « Démarrer la séance » de l'accueil, et le dit au clic. Il remplace « Utiliser ». | Un geste pour rouler ; sans trainer, la séance reste choisissable depuis l'accueil. |

## Pistes étudiées et écartées

Tour 1 (un seul écran, plein écran, navigation intégrée), à l'échelle 1280 × 720 :

| Piste | Principe | Pourquoi pas retenue |
|---|---|---|
| A · Atelier | Rail de navigation à gauche, bibliothèque en panneau, éditeur toujours ouvert à droite. | Le moins « accueil » : l'écran ressemble à un outil. Gardé : l'éditeur toujours ouvert et la bibliothèque en panneau. |
| B · Vitrine | L'accueil d'une séance : titre géant, Rouler au même endroit, profil en bandeau, bibliothèque en étagère de cartes, bouton Modifier qui fait monter l'éditeur. | Deux états (vue, édition). Gardé : le titre géant, Rouler et la navigation en haut à droite, comme l'accueil. |
| C · Canevas | Profil plein écran, bibliothèque en tiroir, inspecteur en bulle sur le bloc, dock de navigation en bas. | Bibliothèque cachée par défaut. Gardé : l'édition tout-en-un, sans bascule. |

Tour 2 (fusion de B et C avec la bibliothèque complète) :

| Piste | Principe | Pourquoi pas retenue |
|---|---|---|
| **D · Miroir de l'accueil** | Grille de l'accueil : bibliothèque dans la colonne de verre de droite, éditeur complet sous le titre. | **Retenue.** |
| E · Étagère vivante | Profil pleine largeur, inspecteur sur une ligne, bibliothèque en étagère à onglets en bas. | Écran plein en hauteur, une seule rangée de cartes. À reprendre si le profil de D paraît trop étroit. |
| F · Canevas à vignettes | Titre sur la scène, bibliothèque repliable en rail de vignettes, inspecteur en bulle, dock en bas. | Plus de pièces mobiles, navigation qui quitte le haut de l'écran. À reprendre pour le tactile. |

Sur D, une recommandation a pesé : c'est la seule piste qui reprend la grille de l'accueil telle quelle, donc la moins coûteuse et la plus familière.

## Téléphone en paysage

**Constat (12 novembre 2026).** L'écran D livré défile sur téléphone : en émulation tactile 844 × 390 px, la page mesure environ 980 px de haut, et l'éditeur n'est jamais entièrement visible. Exigence : tout sur un écran, sans défilement de la page, quitte à avoir des menus dans l'écran.

**Principes** (planche du tour 3, fenêtre de 800 × 360 px à l'échelle réelle) :

- La hauteur est la ressource rare (360 à 430 px en plein écran) ; la largeur (640 à 930 px) est abondante : on dépense la largeur (navigation sur le côté), pas la hauteur.
- Le profil et « Rouler » restent toujours à l'écran. Le reste est à un tap, dans la même fenêtre : tiroir, onglet, feuille, menu.
- Zones tactiles de 36 px et plus. Seule la liste de la bibliothèque peut défiler, dans son propre panneau.
- Technique : une disposition de plus, pour le pointeur tactile en paysage de 460 px de haut ou moins (`@media (pointer: coarse) and (orientation: landscape) and (max-height: 460px)`), en `100dvh` sans défilement, marges de l'encoche (`env(safe-area-inset-*)`). Même balisage et même code que sur ordinateur, qui garde D.

| Piste | Principe | Pour | Contre |
|---|---|---|---|
| **G · Rail et tiroir** (recommandée) | Navigation en rail à gauche ; le titre de la séance ouvre la bibliothèque en tiroir ; profil, blocs et réglages empilés comme sur D. | La plus proche de D, donc peu de code neuf ; profil sur toute la largeur (environ 700 px) ; navigation toujours visible. | Profil de 120 px de haut ; toute la hauteur est utilisée ; actions du bloc en icônes sans texte. |
| H · Deux volets à onglets | Profil à gauche (440 × 150 px), volet de droite à trois onglets : Séances, Bloc, Séance. | Rien ne se superpose ; de grands boutons pour les réglages. | Profil étroit ; changer de séance puis régler un bloc demande un changement d'onglet ; la liste défile dans son panneau ; barre du haut de 36 px. |
| I · Profil à manipuler | Poignées sur le profil pour la puissance et la durée, une barre contextuelle, navigation derrière le logo, bibliothèque en feuille de cartes. | Le plus grand profil (environ 720 × 180 px) ; réglage en tirant. | Gestes tactiles à soigner (pas de 5 % et 15 s, cibles de 44 px) ; navigation à un tap de plus ; récupération et répétitions dans un menu « ⋯ ». |

Choix pour le téléphone : **en attente de la décision**. Recommandation : G ; H si le profil de 120 px est trop petit ; I en seconde étape.

## Écran

Grille de l'accueil : une colonne principale, une colonne de verre de 380 px à droite (280 px mini), la barre du haut de l'application masquée. La navigation (Accueil, Sortie, Séances, Appareils) est celle de l'accueil, l'écran courant en menthe.

**Colonne principale, de haut en bas**

- **En-tête** : petit libellé (Mes séances, Modèle, Nouvelle séance), **nom** de la séance (titre géant, modifiable, souligné en pointillés), **description** (une ligne, modifiable), indicateur « Modifiée, non enregistrée » ou « Modèle · lecture seule ».
- **Actions** : **Rouler**, Enregistrer (ou Dupliquer pour modifier sur un modèle), Exporter .zwo, puis le résumé : durée, puissance moyenne, intensité, charge, avec l'écart par rapport à la version enregistrée.
- **Éditeur** (panneau de verre) : barre d'outils (annuler, rétablir, ajouter un bloc, raccourcis clavier en bulle « ? »), profil sur fond de zones avec info-bulle, axes en % de FTP et en watts, bande de structure avec insertion, une ligne de temps par zone, puis le bloc sélectionné (phrase, champs ±5 % et durées, actions : cadence, avant, après, dupliquer, séparer, supprimer).

**Colonne de droite : bibliothèque.** Titre, « + Nouvelle », recherche, **Mes séances** puis **Modèles** (profil, durée, puissance moyenne, charge ; la séance ouverte est cerclée de menthe), suppression par la croix d'une ligne, import `.zwo`, `.erg`, `.mrc`. Une séance nouvelle, importée ou copiée apparaît en tête de « Mes séances » sous son nom, « Non enregistrée », jusqu'à son enregistrement. Les messages d'import ou d'enregistrement impossible s'affichent dans cette colonne (le journal est masqué sur cet écran).

## Comportements à connaître

- Changer de séance avec des modifications non enregistrées demande confirmation (une boîte du navigateur), comme avant.
- Les flèches, Suppr et Ctrl+Z agissent sur les blocs seulement quand le focus n'est ni dans la bibliothèque, ni dans la navigation, ni dans un champ.
- Quand la FTP change, un modèle en watts (`.erg`, `.mrc`) est relu avec la nouvelle valeur.
- La hauteur du profil suit la hauteur de la fenêtre (100 px mini). Sur une fenêtre basse, la page défile et la bibliothèque reste visible.
- Téléphone en paysage : même disposition, réduite (bibliothèque de 260 px, libellé et description masqués) ; la page défile.

## À faire

- Glisser-déposer des blocs sur le profil (déjà au reste à faire du roadmap).
- **Téléphone en paysage** : l'écran D défile aujourd'hui sur téléphone ; implémenter la disposition retenue parmi G, H, I (voir plus haut). Tester ensuite sur un vrai téléphone.
- Les actions du bloc (cadence, avant, après, séparer) pourraient passer en menu si la colonne principale manque de largeur.
