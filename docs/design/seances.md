# Écran Séances

Référence permanente de l'écran **Séances** : bibliothèque et éditeur sur un seul écran plein écran, dans la continuité de l'accueil. Toute évolution part de ce fichier et le met à jour.

- Code : [`src/ui/workout-editor.ts`](../../src/ui/workout-editor.ts) (bibliothèque et éditeur), [`src/ui/seances.css`](../../src/ui/seances.css) (style), balisage dans [`index.html`](../../index.html) (`data-view="seances"`), branchement dans [`src/main.ts`](../../src/main.ts) (`setupWorkoutEditor`).
- Logique pure, testée : [`src/workout/`](../../src/workout/) (`blocks.ts`, `block-ops.ts`, `history.ts`, `zones.ts`, `library.ts`), inchangée par la refonte.
- Maquettes (claude.ai), dans l'ordre : [tour 1, propositions A, B, C](https://claude.ai/artifact/2EYqkdcgcbfVNsmUkBJfLr) ; [tour 2, fusions D, E, F](https://claude.ai/artifact/9RCni2a8hDKeM26PUyM62Y) ; [tour 3, téléphone en paysage, G, H, I](https://claude.ai/artifact/TDiP7b83DzsLPigxce9kPE) ; [tour 4, commandes sur le bloc, J, K, L](https://claude.ai/artifact/FS16DyG1wruUcz99zDuHTX) ; [tour 5, bibliothèque de blocs préfaits, P, Q, R](https://claude.ai/artifact/4LjWhBFhSY2jaJKc26na9Q) ; [tour 6, section du bas, S, T, U](https://claude.ai/artifact/EVjcLwUJ2TGnojBAaNPDA5). Retenue pour l'ordinateur : **D · Miroir de l'accueil**. Pour le téléphone en paysage : **J · Dans la barre** (voir « Téléphone en paysage »), livrée le 12 novembre 2026.

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-12 | Un seul écran pour la bibliothèque et l'éditeur, plein écran comme l'accueil (scène derrière, panneaux de verre, menthe, Barlow). Plus de page « liste » puis d'éditeur caché. | Choisir une séance sur l'accueil et la créer sur l'écran Séances étaient deux endroits ; l'éditeur restait invisible tant qu'on n'avait rien ouvert. |
| 2026-11-12 | Proposition **B** (accueil d'une séance : titre géant, Rouler) fusionnée avec l'édition tout-en-un de **C** (plus de bascule Modifier / Terminé) et la bibliothèque complète ; variante **D · Miroir de l'accueil** retenue face à E (étagère en bas) et F (rail de vignettes, dock). | D reprend la grille de l'accueil à l'identique : titre et Rouler en bas à gauche, colonne de verre à droite, navigation en haut à droite. C'est la moins coûteuse et la plus familière. |
| 2026-11-12 | Choisir une séance dans la bibliothèque l'**ouvre aussitôt** dans l'éditeur et en fait la séance choisie de l'application (accueil, sortie). À l'arrivée sur l'écran, on ouvre la séance choisie, sauf si un brouillon modifié est en cours. | Une seule séance « courante » dans toute l'application. |
| 2026-11-12 | Un **modèle** s'ouvre en lecture seule (on peut le parcourir et le rouler) ; « Dupliquer pour modifier » en fait une copie non enregistrée. | On ne modifie jamais un modèle livré avec l'application. |
| 2026-11-12 | Téléphone en paysage : piste **J · Dans la barre** (tour 4). L'écran tient dans la fenêtre, sans défilement ; les commandes du bloc sélectionné sont dessinées sur ses barres. | Le retour demandait de simplifier l'écran et de poser les commandes sur le bloc graphique ; J est la plus directe. |
| 2026-11-12 | La bande de pastilles de blocs, proportionnelles à la durée, est **remplacée par la barre du bloc sélectionné** (ordinateur et téléphone). | Avec une dizaine de blocs, les pastilles devenaient illisibles (libellés disparus, débordement sous les boutons). Le profil montre déjà tous les blocs en couleur et se touche pour en choisir un ; la barre donne le nom et le détail du bloc choisi, sa place (3/9), des flèches précédent et suivant, et la poignée de déplacement. |
| 2026-11-12 | **Étagère de blocs préfaits** (piste S du tour 6) : la section du bas devient une étagère toujours visible, qui remplace les six boutons d'ajout génériques ; la barre du bloc, annuler, rétablir et « ⋯ » montent dans l'en-tête sur téléphone. | Des blocs d'entraînement qui ont un sens (Sweet spot 2×20, VO2 5×4, 30/30…), un seul geste pour ajouter (toucher, ou glisser sur le profil), et la section du bas allégée. Retenue contre la recommandation (T), au prix de 80 px de hauteur de profil. |
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

Tour 3 : aucune des trois pistes n'a été retenue telle quelle ; le retour (simplifier l'écran, commandes sur le bloc) a conduit au tour 4. Recommandation de l'époque : G ; H si le profil de 120 px est trop petit ; I en seconde étape.

### Tour 4 : écran simplifié, commandes sur le bloc

**Retour (12 novembre 2026).** Simplifier l'écran, et poser les commandes de modification de l'intervalle **directement sur son bloc graphique**, pour gagner la ligne de réglages. Base : le rail de G (navigation à gauche, titre qui ouvre la bibliothèque), réduit à quatre éléments : titre et sélecteur de séance (avec durée, charge et état en sous-titre), **Rouler**, profil, bande de blocs. Enregistrer, exporter, description et zones passent derrière un « ⋯ » de l'en-tête ; cadence, déplacer, dupliquer, séparer, supprimer le bloc derrière un « ⋯ » sous le profil. Les répétitions d'un intervalle étant liées, on règle un seul motif. Chaque puissance s'affiche en **% de la FTP et en watts** (commandes du bloc et axe du profil). Boutons **compacts** : capsules de 28 px (24 px pour les durées) avec une marge invisible qui porte la zone tactile à 40 px ; Rouler à 36 px, bande de blocs à 32 px, rail de 46 px. La hauteur gagnée va au profil (206 px).

Planche : [tour 4, J, K, L](https://claude.ai/artifact/FS16DyG1wruUcz99zDuHTX), fenêtre de 800 × 360 px à l'échelle réelle.

| Piste | Principe | Pour | Contre |
|---|---|---|---|
| J · Dans la barre | Pas + et − empilés à la verticale dans chaque barre (effort, récupération), pastille de durée en bas de la barre, badge de répétitions au-dessus. | Le plus direct ; cache peu le profil ; avec les capsules compactes, l'intervalle tient. | Colonnes étroites (26 à 30 px, zone tactile de 32 à 36 px sur la récupération) ; durée de la récupération via « ⋯ » ; les commandes se chevauchent encore sur un bloc court (constaté sur un palier de 5 min). |
| K · Bulle sur le bloc | Bulle posée sur le haut du bloc sélectionné, tous les réglages de l'intervalle sur deux lignes ; profil tracé à une échelle plus basse pour laisser de la place. | La plus simple à réaliser ; les cinq champs sous la main, boutons de 32 px. | Barres plus basses ; la bulle couvre le haut du bloc et masque le niveau réglé ; juste de place à 120 % de la FTP. |
| L · Zoom sur une répétition | Toucher un intervalle zoome le profil sur une répétition (effort puis récupération) ; les barres, devenues larges, portent leurs commandes à l'horizontale (puissance et durée) ; badge de répétitions ; la bande de blocs reste la vue d'ensemble. | Cibles de 32 à 36 px sur tout bloc, même court (il est agrandi) ; les cinq champs sur le bloc ; bonne échelle de détail. | Perte de la vue d'ensemble pendant l'édition ; le plus de travail (fenêtre de zoom, transitions, repères) ; changement d'échelle à chaque bloc touché. |

Recommandation : **L**, ou **K** pour aller vite. **Retenue : J** (12 novembre 2026), contre cette recommandation : c'est la plus directe et la plus légère à l'œil ; ses limites (colonnes étroites, bloc très court) sont traitées dans la réalisation, voir ci-dessous.

### Tour 5 : bibliothèque de blocs préfaits (maquettes ; contenu repris par la piste S du tour 6)

**Constat (12 novembre 2026).** L'ajout d'un bloc propose six boutons génériques (Échauffement, Palier, Intervalles, Rampe, Libre, Retour au calme) : chacun insère un bloc par défaut à retoucher, toujours après le bloc sélectionné, sans aperçu. Demande : refondre cette partie en vraie **bibliothèque de blocs préfaits**, placée autrement si utile.

Principes communs : des blocs d'entraînement qui ont un sens (Sweet spot 2×20, VO2 5×4, 30/30 × 10, échauffement avec accélérations), rangés par type et donc par zone de couleur ; **voir avant d'ajouter** (cadre en pointillés sur le profil, durée de la séance mise à jour) ; **choisir la place** (après le bloc sélectionné, ou en glissant) ; **Mes blocs** (« Enregistrer comme bloc » dans le menu ⋯ du bloc) ; les blocs vierges (palier, rampe, libre) restent disponibles.

Planche : [tour 5, P, Q, R](https://claude.ai/artifact/4LjWhBFhSY2jaJKc26na9Q), fenêtre de 800 × 360 px sur l'écran actuel.

| Piste | Principe | Pour | Contre |
|---|---|---|---|
| P · Tiroir « Blocs » | Panneau à droite du profil (onglets Prêts et Mes blocs, types en pastilles, liste avec profil, durée, intensité). « + » ajoute après le bloc sélectionné ; on peut aussi glisser un bloc sur le profil (cadre en pointillés et repère). | Même geste que le déplacement des blocs ; le profil reste visible ; sur ordinateur, onglet « Blocs » à côté de la bibliothèque de séances. | Le profil perd environ 300 px de large le temps du choix ; cinq blocs visibles à la fois ; glisser depuis un tiroir est un geste plus long qu'un tap. |
| Q · Palette par zone, avec aperçu | Feuille du bas avec onglets de couleur et cartes à grand profil ; toucher une carte affiche l'aperçu en pointillés et une barre de confirmation (Ajouter après le bloc 3, Autre place, Annuler). | On voit le résultat et la durée avant de valider ; grandes cartes ; le profil garde sa largeur. | Un tap de plus par ajout ; la feuille couvre la barre du bloc ; « Autre place » demande un second mode. |
| R · Saisie rapide en texte | « + » ouvre une ligne de commande à la place de l'en-tête (`5x 4' 120% r 4' 50%`), résumé reformulé, aperçu en pointillés, suggestions en pastilles. | La plus rapide pour qui connaît ses séances ; les suggestions servent de bibliothèque ; ligne en haut, là où le clavier laisse de la place. | Mini-syntaxe à apprendre, clavier à l'écran ; moins de découverte ; analyseur de texte à écrire et à tester. |

Recommandation : **P, avec l'aperçu de Q** (le cadre apparaît dès qu'on glisse un bloc) ; R en complément plus tard. Choix en attente de la décision.

### Tour 6 : refonte de la section du bas (maquettes ; **retenue : S · Étagère de blocs**, livrée le 12 novembre 2026)

**Précision du retour (12 novembre 2026).** Le tour 5 portait sur ce que le « + » ouvre ; la demande visait en réalité **toute la section du bas** : la barre du bloc sélectionné, qui réunit huit commandes (précédent, poignée, nom et détail, suivant, annuler, rétablir, « + », « ⋯ ») et doit accueillir la bibliothèque de blocs préfaits. Les contenus du tour 5 (types, cartes, aperçu en pointillés) restent valables.

Principes : moins de commandes (annuler et rétablir ne sont pas des commandes du bloc), la bibliothèque dans la section même, un geste pour ajouter (toucher, ou glisser sur le profil, annulable), la hauteur du profil rendue dès que le choix est fait.

Planche : [tour 6, S, T, U](https://claude.ai/artifact/EVjcLwUJ2TGnojBAaNPDA5), fenêtre de 800 × 360 px.

| Piste | Principe | Pour | Contre |
|---|---|---|---|
| S · Étagère de blocs | La section du bas est une étagère toujours visible (pastilles de type, rangée de blocs préfaits à faire défiler). La barre du bloc, annuler, rétablir et « ⋯ » montent dans l'en-tête. | Bibliothèque toujours sous les yeux ; un seul geste pour ajouter ; l'en-tête a de la largeur libre. | 80 px de hauteur en permanence (profil d'environ 170 px) ; en-tête dense ; confusion possible entre blocs du profil et de l'étagère. |
| T · La barre se déplie | La barre garde précédent, poignée, nom, suivant et gagne un bouton « + Bloc » qui la déplie en palette sur place ; toucher une carte ajoute (message « ajouté après le bloc 3 », Annuler). Annuler et rétablir passent dans l'en-tête. | Le plus léger : de la place seulement pendant l'ajout ; barre simplifiée (six commandes) ; ajout en un tap sans confirmation. | Profil réduit à environ 100 px pendant l'ajout ; pas de résultat visible avant l'ajout ; annuler plus loin du pouce. |
| U · « + » en cascade | Bouton rond flottant dans le coin du profil ; pile de types, puis cartes de blocs du type choisi. La barre perd son « + ». | Le profil garde toute sa hauteur ; bouton au coin du pouce ; types comme porte d'entrée. | Trois taps pour ajouter ; pastilles de 22 px ; bouton flottant qui couvre un coin du profil. |

Recommandation : **T** (la plus simple, rend la hauteur dès l'ajout fait) ; S si la bibliothèque doit rester en permanence à l'écran. Choix en attente de la décision.

## Écran

Grille de l'accueil : une colonne principale, une colonne de verre de 380 px à droite (280 px mini), la barre du haut de l'application masquée. La navigation (Accueil, Sortie, Séances, Appareils) est celle de l'accueil, l'écran courant en menthe.

**Colonne principale, de haut en bas**

- **En-tête** : petit libellé (Mes séances, Modèle, Nouvelle séance), **nom** de la séance (titre géant, modifiable, souligné en pointillés), **description** (une ligne, modifiable), indicateur « Modifiée, non enregistrée » ou « Modèle · lecture seule ».
- **Actions** : **Rouler**, Enregistrer (ou Dupliquer pour modifier sur un modèle), Exporter .zwo, puis le résumé : durée, puissance moyenne, intensité, charge, avec l'écart par rapport à la version enregistrée.
- **Éditeur** (panneau de verre) : barre d'outils (annuler, rétablir, raccourcis clavier en bulle « ? »), profil sur fond de zones avec info-bulle, axes en % de FTP et en watts, barre du bloc sélectionné (flèches, nom et détail, place, poignée de déplacement), **étagère de blocs préfaits**, une ligne de temps par zone, puis le bloc sélectionné (phrase, champs ±5 % et durées, actions : cadence, avant, après, dupliquer, séparer, enregistrer comme bloc, supprimer).

**Colonne de droite : bibliothèque.** Titre, « + Nouvelle », recherche, **Mes séances** puis **Modèles** (profil, durée, puissance moyenne, charge ; la séance ouverte est cerclée de menthe), suppression par la croix d'une ligne, import `.zwo`, `.erg`, `.mrc`. Une séance nouvelle, importée ou copiée apparaît en tête de « Mes séances » sous son nom, « Non enregistrée », jusqu'à son enregistrement. Les messages d'import ou d'enregistrement impossible s'affichent dans cette colonne (le journal est masqué sur cet écran).

## Étagère de blocs préfaits

Code : [`src/workout/presets.ts`](../../src/workout/presets.ts) (blocs préfaits, types, résumé d'un bloc), [`src/workout/block-library.ts`](../../src/workout/block-library.ts) (« Mes blocs », stockage local), étagère dans `workout-editor.ts` (`renderShelf`), style `.ed-shelf` dans `seances.css`. Tests : `presets.test.ts` (blocs valides, types, « Mes blocs »).

- **Types** (pastilles à la couleur de leur zone) : Tous, Échauffement, Endurance, Sweet spot, Seuil, VO2 max, Sprint, Retour au calme, **Vierges** (les six blocs par défaut des anciens boutons : Échauffement, Palier, Intervalles, Rampe, Libre, Retour au calme) et **★ Mes blocs**. Quatorze blocs préfaits, deux par type (Progressif, Avec 3 accélérations, Endurance 20 et 45 min, Sweet spot 2×20 et 3×12, Seuil 3×10 et 2×20, VO2 5×4 et 6×3, 30/30 × 10, Sprints 8×15 s, Retour au calme, Descente progressive).
- **Carte** : profil du bloc, nom, durée et intensité principale (« 40:00 · 120 % »). Les puissances sont des fractions de FTP, donc valables pour tout coureur.
- **Ajouter** : toucher ou cliquer une carte l'insère après le bloc sélectionné et le sélectionne ; annuler retire l'ajout. **Glisser** une carte sur le profil l'insère à l'endroit visé : un cadre en pointillés suit le pointeur, un repère menthe montre la place, la lâcher hors du profil annule. Au doigt, un geste vers le haut saisit la carte, un geste horizontal fait défiler l'étagère.
- **Mes blocs** : « Enregistrer comme bloc » (actions du bloc, ordinateur et menu « ⋯ ») demande un nom (proposé : « Intervalles 3 × … ») et range le bloc sélectionné dans le navigateur ; l'onglet s'ouvre, une croix sur la carte le retire. Comme les séances, ces blocs ne suivent pas l'utilisateur d'un appareil à l'autre.
- **Modèle en lecture seule** : les cartes sont bloquées et le disent au toucher.
- **Raccourcis** : Ctrl+Z et Ctrl+Maj+Z fonctionnent même quand le focus est sur l'étagère ; les flèches et Suppr n'y agissent pas sur les blocs.

## Comportements à connaître

- Changer de séance avec des modifications non enregistrées demande confirmation (une boîte du navigateur), comme avant.
- Les flèches, Suppr et Ctrl+Z agissent sur les blocs seulement quand le focus n'est ni dans la bibliothèque, ni dans la navigation, ni dans un champ.
- Quand la FTP change, un modèle en watts (`.erg`, `.mrc`) est relu avec la nouvelle valeur.
- **Barre du bloc sélectionné** (sous le profil) : flèches ‹ › pour passer au bloc précédent ou suivant (même quand un bloc est trop petit pour être touché sur le profil), nom et détail du bloc, place (3/9) et, bien visible en menthe, la poignée **« Glisser »**. Les blocs se choisissent aussi en touchant le profil.
- **Glisser-déposer** (souris et doigt, ordinateur comme téléphone) : on tient la poignée « Glisser » et on la fait glisser vers la gauche ou la droite ; un cadre en pointillés de la taille du bloc suit le pointeur sur le profil, un repère menthe montre où il tombera, les capsules du bloc se masquent le temps du geste. Au dépôt le bloc prend sa place et reste sélectionné. Une seule entrée d'historique (annuler remet l'ordre) ; un modèle en lecture seule n'a pas de poignée. Avant et Après restent dans les actions du bloc. Il n'y a plus de « + » entre les blocs : on ajoute depuis l'étagère, qui insère après le bloc sélectionné ou à l'endroit où l'on dépose une carte.
- Chaque champ de puissance du bloc affiche, à côté du pourcentage, la valeur en watts (selon la FTP) ; elle suit la frappe.
- La hauteur du profil suit la hauteur de la fenêtre (100 px mini). Sur une fenêtre basse, la page défile et la bibliothèque reste visible.
- **Téléphone en paysage** (pointeur tactile, orientation paysage, hauteur de 460 px ou moins ; vérifié en émulation à 667 × 375, 800 × 360, 844 × 390 et 932 × 430 : aucun défilement) : même balisage et même logique que sur ordinateur, une autre disposition en CSS (`seances.css`, bloc final) et la couche de commandes de `renderOverlay()` dans `workout-editor.ts`.
  - **Rail** de navigation à gauche (icônes et libellés de 9 px) ; en-tête réduit au titre (modifiable) avec son sous-titre (durée, charge, état), au chevron qui ouvre la **bibliothèque** en tiroir, au « ⋯ » (Enregistrer, Dupliquer pour modifier, Exporter .zwo, temps par zone) et à **Rouler**.
  - **Commandes sur le bloc sélectionné** : une capsule verticale par puissance (+, valeur en % et en watts, −), une pastille de durée (pas de 15 s), un badge de répétitions pour un intervalle. La pastille se pose au-dessus de la barre, ou en haut du profil quand la barre monte trop haut ; les capsules passent alors dessous. Sur une montée ou une descente (échauffement, rampe, retour au calme), deux capsules, début et fin ; sur un bloc trop étroit (moins de 52 px) une seule, dont la saisie règle aussi le début.
  - **Valeur exacte au toucher** : toucher une valeur (pourcentage et watts, durée, répétitions) ouvre une saisie sur une ligne en haut de l'écran, qui reste visible quand le clavier réduit la fenêtre. Puissance en % et en watts se suivent (on tape l'un ou l'autre), la durée se tape en mm:ss. Toucher la valeur de l'effort règle aussi sa durée et sa cadence cible ; toucher celle de la récupération, les siennes (durée de la récupération comprise) ; sur un palier ou une montée, la puissance, la durée et la cadence du bloc. OK applique d'un coup (une seule entrée d'historique), Échap ou Annuler abandonne, une valeur hors limites est refusée. Les valeurs touchables ont un soulignement en pointillés.
  - **En-tête** (de gauche à droite) : titre et sous-titre, chevron (bibliothèque), **barre du bloc sélectionné** (‹, poignée, nom, place, ›), annuler, rétablir, « ⋯ », **Rouler**. Le « ⋯ » regroupe, sous « Bloc sélectionné », les actions du bloc (Avant, Après, Dupliquer, Séparer pour un intervalle, Enregistrer comme bloc, Supprimer ; la cadence se règle en touchant la valeur sur le profil) puis, sous « Séance », Enregistrer, Dupliquer pour modifier, Exporter .zwo et les temps par zone. Il n'y a plus de feuille de réglages ni de « + » sous le profil.
  - **Étagère** (tout en bas) : voir « Étagère de blocs préfaits ». Le profil gagne la hauteur laissée par la barre du bloc.
  - Boutons en capsules de 28 px, zone tactile de 40 px (marge invisible). Un modèle (lecture seule) n'affiche pas de commandes sur le profil.
  - Limites connues : la description d'une séance ne se modifie pas sur téléphone ; la liste de l'étagère défile de côté (au doigt, un geste horizontal la fait défiler, un geste vers le haut saisit la carte) ; la liste de la bibliothèque défile dans son tiroir ; un intervalle d'une seule répétition peut voir sa pastille de durée près du badge de répétitions.

## À faire

- Glisser-déposer des blocs sur le profil (déjà au reste à faire du roadmap).
- **Téléphone en paysage** : tester sur un vrai téléphone (gestes, zone tactile des capsules étroites de la récupération, encoche) ; décrire la séance et insérer un bloc à un endroit précis sur téléphone.
- Les actions du bloc (cadence, avant, après, séparer) pourraient passer en menu si la colonne principale manque de largeur.
