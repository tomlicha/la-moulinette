# Écrans Appareils et Accueil

Référence permanente des deux écrans d'entrée de l'application. Toute évolution part de ce fichier et le met à jour.

- Code : [`src/ui/radar.ts`](../../src/ui/radar.ts) (radar), [`src/ui/radar-model.ts`](../../src/ui/radar-model.ts) (textes des bulles, testés), [`src/ui/home.css`](../../src/ui/home.css) (style), balisage dans [`index.html`](../../index.html), branchement dans `renderDevices()` de [`src/main.ts`](../../src/main.ts).
- Maquettes (claude.ai) : [Direction graphique](https://claude.ai/artifact/XsuzQxwA5WEKoyn8Jxu4nP), propositions A, B, C puis B1, B2, B3 sous la planche de style. Retenue : **B1 · Médaillon**.

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-11 | Proposition **B · Vestiaire** retenue, avec le radar de la proposition C intégré ; variante **B1 · Médaillon** (le coureur au centre du radar) face à B2 (ondes au sol sous le vélo) et B3 (constellation, radar dans l'en-tête). | B1 est la plus lisible et la plus simple à réaliser, sur grand écran comme sur téléphone. |
| 2026-11-11 | Chaque bulle du radar donne le **rôle** (Trainer, Cardio), puis en plus petit le **nom réel** de l'appareil, puis l'état. Même chose sur l'accueil (radar réduit, sans la ligne d'état). | On reconnaît l'appareil sans lire les cartes. Le nom est celui de l'appareil connecté, sinon celui mémorisé au dernier usage. |
| 2026-11-11 | Parcours : **Appareils → Accueil → Sortie**. L'application s'ouvre toujours sur Appareils (un rechargement perd les connexions Bluetooth) ; quand les appareils connus sont reconnectés, elle passe seule à l'accueil. | Les appareils sont un préalable ; l'accueil est l'endroit où l'on choisit de rouler. |

## Radar

Le coureur est au centre. Le trainer et la ceinture cardio sont des points sur les anneaux, reliés à lui. Le style de chaque état (point, trait, bordure de la bulle) :

| État | Point et trait | Bulle |
|---|---|---|
| Connecté | menthe, plein, halo | rôle, nom, « Connecté » puis les modes pilotables du trainer (« ERG et SIM ») |
| Recherche | rose, pointillé | rôle, nom mémorisé, « Recherche en cours… » |
| Non connecté | gris, pointillé | rôle, nom mémorisé ou « Aucun appareil connu », « Non connecté » |
| Erreur | rouge, pointillé | rôle, nom, « Erreur de connexion » |

Le navigateur ne donne ni la liste des appareils proches ni leur puissance de signal (Web Bluetooth) : le radar montre l'état des appareils connus, pas un balayage réel. Le choix d'un nouvel appareil passe par la fenêtre du navigateur.

Deux variantes, mêmes proportions que la maquette : `full` (520 × 592, écran Appareils) et `mini` (380 × 270, accueil, cliquable vers Appareils). Les positions sont en pourcentage, le dessin suit la largeur de la colonne. Le balayage et l'onde sont coupés si le système demande moins de mouvement.

## Accueil

Écran **plein écran** : le visuel du parcours (« Colline », le seul qui existe) occupe toute la fenêtre, la barre du haut et le journal sont masqués. Par-dessus, en panneaux de verre : la marque et la navigation (Sortie, Séances, Appareils) en haut ; le nom du parcours et le bouton **Rouler** en bas à gauche ; en bas à droite le radar réduit (cliquable vers Appareils) et la séance (choix dans la même liste que l'écran Sortie, profil par zones, **Démarrer la séance**). L'accueil est le point de départ de la navigation ; les autres écrans gardent la barre du haut, où « Accueil » ramène ici. Sur téléphone, les blocs s'empilent et la page défile.

### Fonds et logo

- **Fonds** : trois scènes SVG ([`src/ui/home-scenes.ts`](../../src/ui/home-scenes.ts)) — Rive du lac (couchant), Quais de nuit, Col des Érables (automne) — qui se relaient **toutes les minutes** par fondu de 1,6 s ([`src/ui/home-background.ts`](../../src/ui/home-background.ts)), en repartant d'une scène tirée au hasard. Le titre et la description suivent l'image. Ils nomment l'ambiance : le seul parcours réellement roulé reste « Colline ». Sans mouvement si le système le demande.
- **Logo** « La Moulinette » : capitales Barlow Condensed penchées, « LA » en petit en menthe, et un plateau de pédalier (anneau denté, bras, moyeu) à la place du O, qui tourne au survol. Balisage dans `index.html` (barre du haut et accueil), style `.logo` dans `home.css`, icône de l'onglet `public/favicon.svg`.

## Style

Panneaux de scène (radar, visuel) aux couleurs fixes, comme le HUD ; le reste suit le thème de la page. Sur ces deux écrans uniquement, l'accent est la menthe du jeu (`#5BE3C9`, texte `#0B1422`) au lieu de l'orange des autres écrans. Titres en Barlow Condensed (polices `@fontsource`).

## À faire

- Le portrait du coureur (`public/assets/rider-portrait.jpg`) est recadré d'une planche de la maquette : à remplacer par un rendu de l'avatar réel, personnalisable.
- Un seul monde existe : la sélection de mondes (Col des Érables, Rive du lac, Quais de nuit) de la maquette B n'est pas reprise.
- Le visuel du parcours est un dessin SVG ; à remplacer par un rendu de la scène 3D.
- Accent : décider si menthe devient l'accent de toute l'application (le HUD l'utilise déjà).
