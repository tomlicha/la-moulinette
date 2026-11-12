# Écrans Appareils et Accueil

Référence permanente des deux écrans d'entrée de l'application. Toute évolution part de ce fichier et le met à jour.

- Code : [`src/ui/radar.ts`](../../src/ui/radar.ts) (radar), [`src/ui/radar-model.ts`](../../src/ui/radar-model.ts) (textes des bulles, testés), [`src/ui/home.css`](../../src/ui/home.css) (style), balisage dans [`index.html`](../../index.html), branchement dans `renderDevices()` de [`src/main.ts`](../../src/main.ts).
- Maquettes (claude.ai) : [Direction graphique](https://claude.ai/artifact/XsuzQxwA5WEKoyn8Jxu4nP), propositions A, B, C puis B1, B2, B3 sous la planche de style. Retenue : **B1 · Médaillon**.
- Refonte visuelle du 12 novembre 2026 : [trois directions de l'accueil](https://claude.ai/artifact/WGUyMUZaSszLNa58c1kqzb) (A · Verre givré, **B · Doux et chaleureux**, C · Cockpit sportif). Retenue : **B**, appliquée à tous les écrans (voir « Style »). Ce canevas est privé : seul son propriétaire l'ouvre.

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-11 | Proposition **B · Vestiaire** retenue, avec le radar de la proposition C intégré ; variante **B1 · Médaillon** (le coureur au centre du radar) face à B2 (ondes au sol sous le vélo) et B3 (constellation, radar dans l'en-tête). | B1 est la plus lisible et la plus simple à réaliser, sur grand écran comme sur téléphone. |
| 2026-11-11 | Chaque bulle du radar donne le **rôle** (Trainer, Cardio), puis en plus petit le **nom réel** de l'appareil, puis l'état. Même chose sur l'accueil (radar réduit, sans la ligne d'état). | On reconnaît l'appareil sans lire les cartes. Le nom est celui de l'appareil connecté, sinon celui mémorisé au dernier usage. |
| 2026-11-11 | Parcours : **Appareils → Accueil → Sortie**. L'application s'ouvre toujours sur Appareils (un rechargement perd les connexions Bluetooth) ; quand les appareils connus sont reconnectés, elle passe seule à l'accueil. | Les appareils sont un préalable ; l'accueil est l'endroit où l'on choisit de rouler. |
| 2026-11-12 | Thème **« Doux »** (direction B de la refonte) retenu pour **tous les écrans** : fond crème, cartes blanches très arrondies, accent orange brûlé, **navigation en pastille flottante en bas**. Les trois fonds d'écran (scènes SVG) sont conservés. | Plus accueillant et plus lisible que le verre sombre ; l'orange était déjà l'accent des écrans Appareils et Sortie, ce qui règle le point « accent » resté ouvert. Contre A (évolution douce du verre) et C (cockpit sombre, rail à gauche). |
| 2026-11-12 | Le radar de l'accueil devient une **tuile carrée** (`mini`, 200 × 200), au lieu de 380 × 270 rognée par une hauteur maximale. | À 380 × 270 réduit, l'étiquette « Trainer » recouvrait le médaillon, et en téléphone paysage le médaillon était coupé. La tuile carrée met les étiquettes dans les coins, jamais sur le médaillon. |
| 2026-11-12 | **Invite plein écran** (téléphone en portrait) refaite en carte de verre translucide, avec bouton et astuce iPhone. | L'ancien écran opaque avec un « ⟳ » et un bouton brut était peu accueillant ; voir « Invite plein écran ». |

## Radar

Le coureur est au centre. Le trainer et la ceinture cardio sont des points sur les anneaux, reliés à lui. Le style de chaque état (point, trait, bordure de la bulle) :

| État | Point et trait | Bulle |
|---|---|---|
| Connecté | menthe, plein, halo | rôle, nom, « Connecté » puis les modes pilotables du trainer (« ERG et SIM ») |
| Recherche | rose, pointillé | rôle, nom mémorisé, « Recherche en cours… » |
| Non connecté | gris, pointillé | rôle, nom mémorisé ou « Aucun appareil connu », « Non connecté » |
| Erreur | rouge, pointillé | rôle, nom, « Erreur de connexion » |

Le navigateur ne donne ni la liste des appareils proches ni leur puissance de signal (Web Bluetooth) : le radar montre l'état des appareils connus, pas un balayage réel. Le choix d'un nouvel appareil passe par la fenêtre du navigateur.

Deux variantes : `full` (520 × 592, écran Appareils) et `mini` (200 × 200, accueil, cliquable vers Appareils). Sur l'accueil, `mini` est posée dans une **tuile sombre** (fond en dégradé radial, coins arrondis) : le médaillon est au centre, le trainer en haut à droite, la ceinture cardio en bas à gauche, les pastilles sur l'anneau de 68. Les positions sont en pourcentage, le dessin suit la largeur de la tuile (plafonnée à 340 px) ; les étiquettes gardent des tailles en pixels (14 et 11 px). Le balayage et l'onde sont coupés si le système demande moins de mouvement.

## Accueil

Écran **plein écran** : la scène occupe toute la fenêtre sous un voile crème, la barre du haut et le journal sont masqués. Par-dessus : la marque (pastille blanche) en haut à gauche, puis **une ligne de trois cartes** en bas, au-dessus de la navigation flottante : le nom du monde et le bouton **Rouler** (carte blanche), le radar (tuile sombre, cliquable vers Appareils) et la séance (choix dans la même liste que l'écran Sortie, profil par zones, **Démarrer la séance**, « Créer ou modifier »). Les trois cartes ont la même hauteur (celle de la plus haute) ; colonnes : hero souple, radar et séance de 240 à 340 px.

La **navigation** est la pastille flottante commune à tous les écrans (voir « Style ») ; sur l'accueil elle compte quatre onglets, Accueil marqué comme page courante. L'écran Séances est lui aussi plein écran (voir [seances.md](seances.md)). **Téléphone en paysage** (pointeur tactile, hauteur de 600 px ou moins) : colonnes `1fr · 200 px · 190 px`, cartes resserrées, texte descriptif de la séance masqué, tout tient sans défilement (vérifié en émulation à 863 × 360). **Portrait étroit** (900 px ou moins) : les trois cartes s'empilent et la page défile.

### Fonds et logo

- **Fonds** : trois scènes SVG ([`src/ui/home-scenes.ts`](../../src/ui/home-scenes.ts)) — Rive du lac (couchant), Quais de nuit, Col des Érables (automne) — qui se relaient **toutes les minutes** par fondu de 1,6 s ([`src/ui/home-background.ts`](../../src/ui/home-background.ts)), en repartant d'une scène tirée au hasard. Le titre et la description suivent l'image. Ils nomment l'ambiance : le seul parcours réellement roulé reste « Colline ». Sans mouvement si le système le demande.
- **Logo** « La Moulinette » : capitales Barlow Condensed penchées, « LA » en petit à la couleur d'accent, et un plateau de pédalier (anneau denté, bras, moyeu) à la place du O, qui tourne au survol. Balisage dans `index.html` (barre du haut et accueil), style `.logo` dans `home.css`, icône de l'onglet `public/favicon.svg`.

## Style

Thème **« Doux »**, défini par des jetons dans [`src/style.css`](../../src/style.css) :

- **Clair** : fond crème `#F4EDE3`, cartes `#FFF`, texte `#14171A`, texte atténué `#4F5865`, accent orange brûlé `#C2410C` (texte blanc dessus, 5,2:1), rayon des cartes 24 px, ombres chaudes (`--shadow-card`, `--shadow-nav`). **Nuit** (thème du système) : ardoise d'avant, accent `#FF8743`.
- **Écrans posés sur la scène (Accueil, Séances)** : palette claire **fixe**, quel que soit le thème du système, comme le HUD qui reste en verre sombre (`hud.css`). Le radar est aussi une tuile aux couleurs fixes ; sa menthe est celle du jeu et n'est plus l'accent de l'interface.
- **Navigation** : une seule pastille flottante en bas, au centre (`.topbar nav` et `.home-nav` partagent les règles de `style.css`), icônes 18 px et libellés, onglet courant à l'accent. Exceptions : sur la **Sortie** elle reste dans la barre du haut, pour ne pas recouvrir les compteurs de la vue 3D ; sur **Séances en téléphone paysage** elle redevient un rail vertical à gauche (la hauteur est trop rare).
- **En-tête des pages** (Appareils, Sortie) : marque en pastille blanche à gauche, états des appareils en pastilles à droite.
- Titres en Barlow Condensed (polices `@fontsource`). Les liens suivent l'accent.

## Invite plein écran (téléphone en portrait)

Code : balisage `#rotate-hint` en tête de [`index.html`](../../index.html), style dans `style.css` (« Mode application sur mobile »), comportement dans [`src/ui/app-shell.ts`](../../src/ui/app-shell.ts).

Sur mobile (pointeur tactile) tenu en portrait, un voile translucide (flou, halo menthe) recouvre l'application, qui reste visible derrière ; au centre, une carte de verre : téléphone qui bascule du portrait au paysage, « Mets ton téléphone à l'horizontale », une phrase d'explication et le bouton **Passer en plein écran**. Le bouton est masqué quand le plein écran est impossible ou déjà actif (mode installé, `fullscreenchange`) ; sans l'API (Safari sur iPhone), il laisse place à l'astuce « Partager → Sur l'écran d'accueil ». L'invite disparaît dès que le téléphone est à l'horizontale ; le premier toucher passe toujours en plein écran paysage. Animations coupées si le système demande moins de mouvement.

## À faire

- Le portrait du coureur est **rendu au chargement d'après `avatar.glb` et `bike.glb`** ([`src/render/rider-portrait.ts`](../../src/render/rider-portrait.ts), même classe `Rider` que la sortie) : il suit donc toute évolution de l'avatar, sans image à régénérer. `public/assets/rider-portrait.jpg` n'est plus qu'un repli (chargement, rendu impossible) ; il peut être supprimé quand ce repli ne sert plus. Reste à rendre l'avatar personnalisable (maillot, couleurs).
- Un seul monde existe : la sélection de mondes (Col des Érables, Rive du lac, Quais de nuit) de la maquette B n'est pas reprise.
- Le visuel du parcours est un dessin SVG ; à remplacer par un rendu de la scène 3D.
- Thème « Doux » : vérifié en émulation (Pixel 7 en paysage, ordinateur 1280 × 800, clair et nuit pour Appareils) ; reste à l'essayer sur un vrai téléphone. Le HUD garde son verre sombre et sa menthe ; à reprendre si l'on veut l'aligner sur l'orange.
- La pastille « trainer : disconnected » de la carte Appareils est encore en anglais (état brut du trainer) ; à traduire.
