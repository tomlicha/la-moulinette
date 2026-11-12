# Écran Séances

Référence permanente de l'écran **Séances** : bibliothèque et éditeur sur un seul écran plein écran, dans la continuité de l'accueil. Toute évolution part de ce fichier et le met à jour.

- Code : [`src/ui/workout-editor.ts`](../../src/ui/workout-editor.ts) (bibliothèque et éditeur), [`src/ui/seances.css`](../../src/ui/seances.css) (style), balisage dans [`index.html`](../../index.html) (`data-view="seances"`), branchement dans [`src/main.ts`](../../src/main.ts) (`setupWorkoutEditor`).
- Logique pure, testée : [`src/workout/`](../../src/workout/) (`blocks.ts`, `block-ops.ts`, `history.ts`, `zones.ts`, `library.ts`), inchangée par la refonte.
- Maquettes (claude.ai) : [trois propositions A, B, C](https://claude.ai/artifact/2EYqkdcgcbfVNsmUkBJfLr), puis [trois fusions D, E, F](https://claude.ai/artifact/9RCni2a8hDKeM26PUyM62Y). Retenue : **D · Miroir de l'accueil**.

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-12 | Un seul écran pour la bibliothèque et l'éditeur, plein écran comme l'accueil (scène derrière, panneaux de verre, menthe, Barlow). Plus de page « liste » puis d'éditeur caché. | Choisir une séance sur l'accueil et la créer sur l'écran Séances étaient deux endroits ; l'éditeur restait invisible tant qu'on n'avait rien ouvert. |
| 2026-11-12 | Proposition **B** (accueil d'une séance : titre géant, Rouler) fusionnée avec l'édition tout-en-un de **C** (plus de bascule Modifier / Terminé) et la bibliothèque complète ; variante **D · Miroir de l'accueil** retenue face à E (étagère en bas) et F (rail de vignettes, dock). | D reprend la grille de l'accueil à l'identique : titre et Rouler en bas à gauche, colonne de verre à droite, navigation en haut à droite. C'est la moins coûteuse et la plus familière. |
| 2026-11-12 | Choisir une séance dans la bibliothèque l'**ouvre aussitôt** dans l'éditeur et en fait la séance choisie de l'application (accueil, sortie). À l'arrivée sur l'écran, on ouvre la séance choisie, sauf si un brouillon modifié est en cours. | Une seule séance « courante » dans toute l'application. |
| 2026-11-12 | Un **modèle** s'ouvre en lecture seule (on peut le parcourir et le rouler) ; « Dupliquer pour modifier » en fait une copie non enregistrée. | On ne modifie jamais un modèle livré avec l'application. |
| 2026-11-12 | **Rouler** enregistre la séance si besoin, la choisit, va sur la sortie et la démarre. Il attend un trainer connecté avec ERG, comme « Démarrer la séance » de l'accueil, et le dit au clic. Il remplace « Utiliser ». | Un geste pour rouler ; sans trainer, la séance reste choisissable depuis l'accueil. |

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
- Tester l'écran sur un vrai téléphone en paysage ; le profil y est petit (120 px).
- Les actions du bloc (cadence, avant, après, séparer) pourraient passer en menu si la colonne principale manque de largeur.
