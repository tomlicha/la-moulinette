# Écrans Appareils et Accueil

Référence permanente des deux écrans d'entrée de l'application. Toute évolution part de ce fichier et le met à jour.

- Code : [`src/ui/radar.ts`](../../src/ui/radar.ts) (radar), [`src/ui/radar-model.ts`](../../src/ui/radar-model.ts) (textes des bulles, testés), [`src/ui/rider-profile.ts`](../../src/ui/rider-profile.ts) (fiche du coureur), [`src/workout/zones.ts`](../../src/workout/zones.ts) (`zoneRangesW`, zones en watts, testées), [`src/ui/home.css`](../../src/ui/home.css) (style), balisage dans [`index.html`](../../index.html), branchement dans `renderDevices()` de [`src/main.ts`](../../src/main.ts).
- Maquettes (claude.ai) : [Direction graphique](https://claude.ai/artifact/XsuzQxwA5WEKoyn8Jxu4nP), propositions A, B, C puis B1, B2, B3 sous la planche de style. Retenue : **B1 · Médaillon**.
- Refonte visuelle du 12 novembre 2026 : [trois directions de l'accueil](https://claude.ai/artifact/WGUyMUZaSszLNa58c1kqzb) (A · Verre givré, **B · Doux et chaleureux**, C · Cockpit sportif). Retenue : **B**, appliquée à tous les écrans (voir « Style »). Ce canevas est privé : seul son propriétaire l'ouvre.
- Refonte de l'écran Appareils du 12 novembre 2026 : [trois propositions](https://claude.ai/artifact/FH2tcDEQvkHgZJU9ZrGij7) (A · Tableau, B · Radar vivant, C · Grille d'accueil). Retenue : **C avec l'idée de B** (voir « Appareils »). Canevas privé.

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-11 | Proposition **B · Vestiaire** retenue, avec le radar de la proposition C intégré ; variante **B1 · Médaillon** (le coureur au centre du radar) face à B2 (ondes au sol sous le vélo) et B3 (constellation, radar dans l'en-tête). | B1 est la plus lisible et la plus simple à réaliser, sur grand écran comme sur téléphone. |
| 2026-11-11 | Chaque bulle du radar donne le **rôle** (Trainer, Cardio), puis en plus petit le **nom réel** de l'appareil, puis l'état. Même chose sur l'accueil (radar réduit, sans la ligne d'état). | On reconnaît l'appareil sans lire les cartes. Le nom est celui de l'appareil connecté, sinon celui mémorisé au dernier usage. |
| 2026-11-11 | Parcours : **Appareils → Accueil → Sortie**. L'application s'ouvre toujours sur Appareils (un rechargement perd les connexions Bluetooth) ; quand les appareils connus sont reconnectés, elle passe seule à l'accueil. | Les appareils sont un préalable ; l'accueil est l'endroit où l'on choisit de rouler. |
| 2026-11-12 | Thème **« Doux »** (direction B de la refonte) retenu pour **tous les écrans** : fond crème, cartes blanches très arrondies, accent orange brûlé, **navigation en pastille flottante en bas**. Les trois fonds d'écran (scènes SVG) sont conservés. | Plus accueillant et plus lisible que le verre sombre ; l'orange était déjà l'accent des écrans Appareils et Sortie, ce qui règle le point « accent » resté ouvert. Contre A (évolution douce du verre) et C (cockpit sombre, rail à gauche). |
| 2026-11-12 | Le radar de l'accueil devient une **tuile carrée** (`mini`, 200 × 200), au lieu de 380 × 270 rognée par une hauteur maximale. | À 380 × 270 réduit, l'étiquette « Trainer » recouvrait le médaillon, et en téléphone paysage le médaillon était coupé. La tuile carrée met les étiquettes dans les coins, jamais sur le médaillon. |
| 2026-11-12 | Écran **Appareils** refait sur la grille de l'accueil (proposition **C**), avec l'idée de **B** : toucher le médaillon du radar ouvre la fiche du coureur. Trainer et capteur cardiaque sont réunis dans **une seule carte « Capteurs »**. Le profil du cycliste (masse, FTP, zones) rejoint l'écran. | Même carte titre, même tuile radar, même bouton que l'accueil : transition naturelle, tout visible sans défiler. Une carte « Capteurs » unique évite deux cartes quasi identiques ; la fiche du coureur n'occupe de la place que sur demande. |
| 2026-11-12 | Masse et FTP se choisissent sur une **roulette de chiffres en surimpression**, pas au clavier ; la FTP en trois roulettes (centaines, dizaines, unités), de 1 W en 1. | Le clavier du téléphone masque la moitié de l'écran, surtout en paysage ; une roulette se manie au pouce. |
| 2026-11-12 | **Radar clair** : la tuile sombre (bleu nuit, menthe) devient une tuile crème aux bulles blanches, sur l'écran Appareils comme sur l'accueil ; la « ceinture » devient un **capteur cardiaque** dans les textes. | Cohérence avec le thème « Doux » : la tuile sombre était le seul élément noir des deux écrans. « Capteur » couvre une ceinture, une montre ou un bracelet. |
| 2026-11-12 | **Invite plein écran** (téléphone en portrait) refaite en carte de verre translucide, avec bouton et astuce iPhone. | L'ancien écran opaque avec un « ⟳ » et un bouton brut était peu accueillant ; voir « Invite plein écran ». |

## Radar

Le coureur est au centre. Le trainer et le capteur cardiaque sont des points sur les anneaux, reliés à lui. Le style de chaque état (point, trait, bordure de la bulle) :

| État | Point et trait | Bulle |
|---|---|---|
| Connecté | vert, plein, halo | rôle, nom, « Connecté » puis les modes pilotables du trainer (« ERG et SIM ») |
| Recherche | rose, pointillé | rôle, nom mémorisé, « Recherche en cours… » |
| Non connecté | gris, pointillé | rôle, nom mémorisé ou « Aucun appareil connu », « Non connecté » |
| Erreur | rouge, pointillé | rôle, nom, « Erreur de connexion » |

Le navigateur ne donne ni la liste des appareils proches ni leur puissance de signal (Web Bluetooth) : le radar montre l'état des appareils connus, pas un balayage réel. Le choix d'un nouvel appareil passe par la fenêtre du navigateur.

Une seule géométrie, **carrée** (200 × 200 dans le repère du dessin) : le médaillon au centre, le trainer en haut à droite, le capteur cardiaque en bas à gauche, les pastilles sur l'anneau de 68. Deux variantes : `mini` (accueil, tuile de 200 à 340 px, cliquable vers Appareils) et `large` (Appareils, 200 à 250 px, avec la ligne d'état dans chaque bulle). Sur l'écran Appareils le **médaillon est un bouton** qui ouvre la fiche du coureur (option `onRider`). Les positions sont en pourcentage ; les étiquettes gardent des tailles en pixels. Le balayage et l'onde sont coupés si le système demande moins de mouvement. L'ancienne variante `full` (520 × 592) a disparu avec la refonte.

## Appareils

Écran **plein écran** comme l'accueil et les séances : la scène en fond sous le voile crème, la marque en pastille et la navigation flottante, avec Appareils comme page courante ; la barre du haut et le journal sont masqués, comme sur l'accueil : la page ne défile pas (sauf aide ouverte ou fenêtre trop basse). La fiche du coureur défile dans sa carte si l'écran est trop bas ; les zones y tiennent sur une ligne (« ≤ 139 W », « ≥ 303 W »).

- **Ligne du haut** : une carte titre (« Équipe ton coureur », une phrase, le résumé du coureur, **Continuer vers l'accueil** et « Continuer sans trainer ») et la tuile radar `large`.
- **Carte « Capteurs »** : le home trainer et le capteur cardiaque côte à côte dans une seule carte. Chaque colonne donne l'icône, le nom de l'appareil, l'état (« Connecté », « Connexion… », « Erreur de connexion », « Non connecté »), puis les boutons de connexion. Une ligne d'aide repliée (« Ton trainer n'apparaît pas… », avec le choix du protocole) et l'état du Bluetooth web complètent la carte.
- **Fiche du coureur** : on l'ouvre en touchant le médaillon du radar ou le résumé « Mon coureur · 78 kg · FTP 230 W · 2,95 W/kg ». Une boîte de dialogue montre le portrait, le rapport W/kg, la masse et la FTP. Une valeur se choisit sur une **roulette de chiffres en surimpression** ([`src/ui/wheel-picker.ts`](../../src/ui/wheel-picker.ts)) : on touche la valeur, la roulette s'ouvre par-dessus la fiche, les chiffres défilent et s'accrochent au centre, puis OK. La **masse** a une roulette unique (de 1 kg en 1) ; la **FTP** en a **trois**, centaines, dizaines et unités, pour composer la valeur chiffre par chiffre, de 1 W en 1 (une combinaison hors de 50–600 W est ramenée dans les bornes). Aucun clavier ne sort sur téléphone ; les boutons − et + avancent aussi de 1 ; la fiche montre enfin les six zones en watts. Les champs `#mass` et `#wo-ftp` (cachés, dans l'écran Sortie) restent la source de vérité : la fiche les met à jour et déclenche leur `change`, donc la FTP continue d'être mémorisée et le profil des séances se redessine. La **masse est maintenant mémorisée** aussi (`zwift2.mass`) ; elle est figée pendant une sortie, la fiche le dit.
- **Téléphone en paysage** (pointeur tactile, 600 px de haut ou moins) : titre, résumé et boutons en deux lignes à côté d'une tuile radar de 104 px sans étiquettes, capteurs dessous, aide réduite à un lien « Aide ? » dans le coin de la carte. Tout tient dans 360 px de haut (vérifié en émulation de 800 × 360 à 863 × 390) ; au-dessous de 760 px de large la page défile. Chaque capteur n'affiche que les boutons utiles à son état (connecté : seulement « Déconnecter »), sur une seule ligne, pour que la carte ne grandisse pas sous la navigation. **Portrait étroit** : titre, radar, puis les deux capteurs s'empilent.

## Accueil

Écran **plein écran** : la scène occupe toute la fenêtre sous un voile crème, la barre du haut et le journal sont masqués. Par-dessus : la marque (pastille blanche) en haut à gauche, puis **une ligne de trois cartes** en bas, au-dessus de la navigation flottante : le nom du monde et le bouton **Rouler** (carte blanche), le radar (tuile sombre, cliquable vers Appareils) et la séance (choix dans la même liste que l'écran Sortie, profil par zones, **Démarrer la séance**, « Créer ou modifier »). Les trois cartes ont la même hauteur (celle de la plus haute) ; colonnes : hero souple, radar et séance de 240 à 340 px.

La **navigation** est la pastille flottante commune à tous les écrans (voir « Style ») ; sur l'accueil elle compte quatre onglets, Accueil marqué comme page courante. L'écran Séances est lui aussi plein écran (voir [seances.md](seances.md)). **Téléphone en paysage** (pointeur tactile, hauteur de 600 px ou moins) : colonnes `1fr · 200 px · 190 px`, cartes resserrées, texte descriptif de la séance masqué, tout tient sans défilement (vérifié en émulation à 863 × 360). **Portrait étroit** (900 px ou moins) : les trois cartes s'empilent et la page défile.

### Fonds et logo

- **Fonds** : trois scènes SVG ([`src/ui/home-scenes.ts`](../../src/ui/home-scenes.ts)) — Rive du lac (couchant), Quais de nuit, Col des Érables (automne) — qui se relaient **toutes les minutes** par fondu de 1,6 s ([`src/ui/home-background.ts`](../../src/ui/home-background.ts)), en repartant d'une scène tirée au hasard. Le titre et la description suivent l'image. Ils nomment l'ambiance : le seul parcours réellement roulé reste « Colline ». Sans mouvement si le système le demande.
- **Logo** « La Moulinette » : capitales Barlow Condensed penchées, « LA » en petit à la couleur d'accent, et un plateau de pédalier (anneau denté, bras, moyeu) à la place du O, qui tourne au survol. Balisage dans `index.html` (barre du haut et accueil), style `.logo` dans `home.css`, icône de l'onglet `public/favicon.svg`.

## Style

Thème **« Doux »**, défini par des jetons dans [`src/style.css`](../../src/style.css) :

- **Clair** : fond crème `#F4EDE3`, cartes `#FFF`, texte `#14171A`, texte atténué `#4F5865`, accent orange brûlé `#C2410C` (texte blanc dessus, 5,2:1), rayon des cartes 24 px, ombres chaudes (`--shadow-card`, `--shadow-nav`). **Nuit** (thème du système) : ardoise d'avant, accent `#FF8743`.
- **Écrans posés sur la scène (Accueil, Appareils, Séances)** : palette claire **fixe**, quel que soit le thème du système, comme le HUD qui reste en verre sombre (`hud.css`). Le radar est une **tuile claire** (fond crème dégradé, bulles blanches, médaillon cerclé de l'accent orange), à couleurs fixes elle aussi ; le vert, le rose, le gris et le rouge y disent l'état des appareils. La menthe reste celle du jeu (HUD, invite plein écran).
- **Navigation** : une seule pastille flottante en bas, au centre (`.home-nav`, règles dans `style.css`), icônes 18 px et libellés, onglet courant à l'accent. Exceptions : la **Sortie** n'a pas de pastille (elle recouvrirait le HUD) : sa navigation est dans le menu contextuel ([sortie.md](sortie.md)) ; sur **Séances en téléphone paysage** elle redevient un rail vertical à gauche (la hauteur est trop rare).
- Les quatre écrans sont plein écran. La barre du haut de l'ancienne Sortie (marque, navigation, pastilles d'état) a été supprimée le 2026-11-12.
- Titres en Barlow Condensed (polices `@fontsource`). Les liens suivent l'accent.

## Invite plein écran (téléphone en portrait)

Code : balisage `#rotate-hint` en tête de [`index.html`](../../index.html), style dans `style.css` (« Mode application sur mobile »), comportement dans [`src/ui/app-shell.ts`](../../src/ui/app-shell.ts).

Sur mobile (pointeur tactile) tenu en portrait, un voile translucide (flou, halo menthe) recouvre l'application, qui reste visible derrière ; au centre, une carte de verre : téléphone qui bascule du portrait au paysage, « Mets ton téléphone à l'horizontale », une phrase d'explication et le bouton **Passer en plein écran**. Le bouton est masqué quand le plein écran est impossible ou déjà actif (mode installé, `fullscreenchange`) ; sans l'API (Safari sur iPhone), il laisse place à l'astuce « Partager → Sur l'écran d'accueil ». L'invite disparaît dès que le téléphone est à l'horizontale ; le premier toucher passe toujours en plein écran paysage. Animations coupées si le système demande moins de mouvement.

## À faire

- Le portrait du coureur est **rendu au chargement d'après `avatar.glb` et `bike.glb`** ([`src/render/rider-portrait.ts`](../../src/render/rider-portrait.ts), même classe `Rider` que la sortie) : il suit donc toute évolution de l'avatar, sans image à régénérer. `public/assets/rider-portrait.jpg` n'est plus qu'un repli (chargement, rendu impossible) ; il peut être supprimé quand ce repli ne sert plus. Reste à rendre l'avatar personnalisable (maillot, couleurs).
- Un seul monde existe : la sélection de mondes (Col des Érables, Rive du lac, Quais de nuit) de la maquette B n'est pas reprise.
- Le visuel du parcours est un dessin SVG ; à remplacer par un rendu de la scène 3D.
- Thème « Doux » : vérifié en émulation (téléphone en paysage 863 × 360, portrait 800 × 1100, ordinateur 1280 × 720) ; reste à l'essayer sur un vrai téléphone. L'écran Appareils a une palette claire fixe (comme l'accueil), il ne suit plus le thème nuit. Le HUD garde son verre sombre et sa menthe ; à reprendre si l'on veut l'aligner sur l'orange.
