# HUD de la sortie

Référence permanente du HUD affiché par-dessus la vue 3D (écran **Sortie**, voir [sortie.md](sortie.md) pour l'écran lui-même). Toute évolution du HUD part de ce fichier et le met à jour.

- Code : [`src/ui/hud.ts`](../../src/ui/hud.ts) (affichage), [`src/ui/hud.css`](../../src/ui/hud.css) (style), [`src/ui/hud-model.ts`](../../src/ui/hud-model.ts) (calculs purs, testés).
- Branchement : `renderHud()` dans [`src/main.ts`](../../src/main.ts), rafraîchi à 4 Hz tant que l'écran Sortie est affiché.
- Planches de travail (claude.ai) : [trois propositions](https://claude.ai/artifact/749sgeL3BqXciEr1dpn4q2), [lisibilité](https://claude.ai/artifact/BwzRiDrk5v9ZZM63hjqmaK), [paliers à venir](https://claude.ai/artifact/7NTViEqa8FnhgmXXgDvoif). Direction graphique d'origine : [Direction graphique](https://claude.ai/artifact/XsuzQxwA5WEKoyn8Jxu4nP), planches Main, Erg et Style.

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-11 | Proposition **A · Panneaux** retenue, face à « Compteur » (un bloc dans un coin) et « Flottant » (chiffres sans panneau). | Reprend la maquette validée ; chaque information a une place fixe, la même en sortie libre et en séance. |
| 2026-11-11 | Puissance regroupée avec FC, cadence et vitesse dans un seul bloc en haut au centre ; puissance dominante ; altitude retirée. | Un seul endroit à regarder, juste au-dessus du cycliste. L'altitude n'aide pas à rouler ; le dénivelé cumulé et la pente suffisent. |
| 2026-11-11 | Widgets réduits à 90 % (`--hud-k`). | Moins de scène masquée, lisibilité intacte. |
| 2026-11-11 | Cartes de mesures sous la vue retirées ; HUD complet affiché dès l'écran Sortie ; téléphone en paysage uniquement. | Le HUD est l'affichage unique ; pas de saut de mise en page au départ de la sortie. |
| 2026-11-12 | La sortie passe **plein écran** : le HUD couvre la fenêtre, sa scène 1280 × 720 est ajustée et centrée ; le message de la séance s'y affiche. | Voir [sortie.md](sortie.md). |
| 2026-11-11 | **Verre dépoli** retenu pour la lisibilité, face à « Bandeau opaque » et « Clair adaptatif ». | Le gris translucide laissait passer le ciel clair : libellés gris clair autour de 2,5:1 devant les nuages (calcul à la main, à remesurer dans la planche « Lisibilité »). Le flou supprime les contours nets sous le texte ; la teinte plus dense et les libellés éclaircis remontent le contraste, sans changer l'esprit de la maquette. |
| 2026-11-13 | Liste **« À suivre »** sous la tuile du palier, proposition **A′ · Pile compacte**, face à « Barres d'intensité » et « Fil du temps ». Une ligne par palier : les watts et la durée, sans le type. Une série d'intervalles tient dans un cadre, avec ses deux paliers et le numéro de répétition. | Lisible d'un regard en plein effort, sans second panneau. Le type de palier n'apporte rien : la couleur et les watts suffisent. Avec des 30/30, quatre lignes identiques ne disaient rien de plus ; le cadre montre la série et où on en est. |
| 2026-11-13 | **Zones plus vives** dans tout le HUD (tuile, liste, barre de zones, profil de séance), Z1 en gris clair ; texte foncé sur toutes les pastilles, Z6 compris. | Les teintes de la planche de style paraissaient ternes sur le verre sombre, surtout en série d'intervalles. Le gris de Z1 reste gris, comme le veut l'usage, mais clair. |

## Repère et mise en page

Le HUD est mis en page dans une scène fixe de **1280 × 720 px**, puis ajustée à la fenêtre : `--hud-s` = le plus petit de largeur / 1280 et hauteur / 720, et la scène est centrée (`--hud-x`, `--hud-y`). Le HUD couvre toute la fenêtre hors zones sûres ; sur un écran plus large ou plus haut que 16:9, les panneaux restent à leur taille et gardent leurs marges. Les panneaux sont ensuite réduits à 90 % (`--hud-k`) autour de leur point d'ancrage, qui les garde collés à leur bord.

| Panneau | Position (scène 1280 × 720) | Ancrage du 90 % | Contenu |
|---|---|---|---|
| Gauche | x 64, y 36, l 250 | haut gauche | Sortie libre : nom du parcours, temps, distance, dénivelé positif. Séance : palier (type, n° / total, ou « rép. 3 / 10 » dans une série), compte à rebours, barre de progression, temps fait / durée, cadence visée, puis la liste « À suivre » (voir plus bas). |
| Centre | x 340, y 36, l 600 | haut centre | Puissance 3 s (76 px), séparateur, puis trois colonnes à 38 px : FC, cadence, vitesse (sortie libre) ou cible, FC, cadence (séance). Barre de zones. Ligne du bas : pastille de zone et % de la FTP, ou en séance pastille de zone, ERG, écart, plage cible ± 5 %. |
| Bas | x 64, y 596, l 1152, h 90 | bas centre | Sortie libre : pente, profil du tour avec position, prochain sommet en pointillé, mode SIM ou ERG, état du trainer et de la ceinture. Séance : nom, temps fait / total, palier suivant, profil de la séance avec curseur, paliers passés atténués. |
| Message | x 340, y 214, l 600 | haut centre | Message de la séance en cours (consigne du fichier), sous le panneau central ; absent sans message. |
| Haut droit | libre | | Bouton du menu de la sortie ; réservé en dessous à la liste du groupe (multijoueur). Le compteur de rendu (`view-stats`), masqué par défaut, s'y affiche si on le demande dans le menu. |

États :

- **Sortie libre**, y compris avant le départ : les trois panneaux, version sortie. Avant le départ, le parcours et la pente sont en « – », le profil montre le départ et le premier sommet ; le HUD ne change donc pas de forme au démarrage.
- **Séance** : les trois panneaux, version séance ; la vitesse sort du bloc central pour laisser la place à la cible.

**Porte du palier suivant** (dans la scène 3D, pas dans le HUD) : en séance, 30 s avant chaque changement de palier, une arche enjambe la route devant le cycliste, de la couleur de la zone du palier qui commence (`--hz1` … `--hz6`, blanc devant un palier libre). La séance avançant au temps, la porte est posée là où le cycliste sera à sa vitesse du moment (au moins 2 m/s, au plus 400 m devant) et se recale en douceur ; il la franchit au début du palier, puis elle s'efface. Rien sur le dernier palier ni en pause. Logique dans `workout/gate.ts`, rendu dans `render/interval-gate.ts`.

**Liste « À suivre »** (séance, panneau gauche, sous un filet) :

- En-tête : « À suivre », à droite le nombre de paliers après la liste et le temps jusqu'à la fin (« + 31 · fin dans 47:12 ») ; « Dernier palier » quand il n'y a plus rien.
- Au plus **4 éléments**. Une ligne par palier (30 px) : un bloc plein de la couleur de zone avec les watts en texte foncé, dont la longueur suit la consigne (66 px à 0, toute la largeur à 150 % de la FTP), puis la durée (« 30 s » sous la minute). Un dégradé de la zone part du bloc et s'efface vers la droite. Rampe : bloc en dégradé d'une zone à l'autre, « 156→117 ». Palier libre : bloc vide cerclé de blanc, « libre ».
- Le premier élément, ce qui arrive, est plus haut (38 px), plus grand, cerclé de sa zone avec un léger halo. Les troisième et quatrième s'estompent un peu (92 %, 82 %).
- **Série d'intervalles** : deux paliers A et B différents qui alternent (A, B, A…), A au moins deux fois ; un palier qui rompt l'alternance clôt la série. Elle compte pour un élément : un cadre clair avec A et B une seule fois, et à droite « rép. 4/10 », la répétition en cours ou sur le point de commencer. En tête de liste, celui des deux qui arrive est cerclé. Le dernier palier d'une série, s'il reste seul, s'affiche comme une ligne normale.
- Les watts suivent l'intensité réglée en cours de séance. La liste est reconstruite à chaque changement de palier et glisse vers le haut (0,45 s, sans animation si l'utilisateur réduit les mouvements).

Le HUD est le seul affichage des mesures : il n'y a plus de cartes sous la vue (retirées le 2026-11-11). Sous la vue ne restent que les commandes (sortie, séance, pilotage manuel, enregistrement).
Le HUD est le seul affichage des mesures : il n'y a plus de cartes sous la vue (retirées le 2026-11-11), et depuis le 2026-11-12 plus rien sous la vue du tout : les commandes (sortie, séance, pilotage manuel, enregistrement) sont dans le menu contextuel de la sortie ([sortie.md](sortie.md)).

Téléphone : application en **paysage uniquement**, pas de version portrait du HUD à prévoir.

Une mesure absente ou muette depuis plus de 3 s s'affiche « – », jamais la dernière valeur connue.

## Style

Couleurs fixes, indépendantes du thème clair ou sombre de la page : le HUD est toujours posé sur la scène.

| Jeton | Valeur | Usage |
|---|---|---|
| `--hud-panel` | `rgba(24, 30, 40, .70)` | fond des panneaux, sous le flou |
| `--hud-blur` | `blur(16px) saturate(1.3)` | `backdrop-filter` des panneaux |
| `--hud-panel-flat` | `rgba(24, 30, 40, .84)` | repli sans flou (qualité réduite, navigateur sans `backdrop-filter`) |
| `--hud-edge` | `rgba(255, 255, 255, .14)` | bordure 1 px |
| `--hud-shadow` | `0 8px 28px rgba(5, 10, 20, .25)` | détache le panneau du ciel |
| `--hud-fg` | `#FFFFFF` | chiffres et titres |
| `--hud-muted` | `#D3DCE8` | libellés et unités (et non plus `#A9B8CC`, trop faible devant un ciel clair) |
| `--hud-accent` | `#5BE3C9` | pastilles ERG / SIM, partie parcourue du profil, capteur connecté |
| `--hud-relief` | `#66758B` | profil du parcours à venir |
| `--hz1` … `--hz6` | `#C4CDD8` `#2E9BFF` `#1FE07F` `#FFD60A` `#FF7A1A` `#FF2D55` | zones de puissance, version vive (celles de la planche de style étaient `#8C99A8` `#3B82D6` `#2FA36B` `#F2C230` `#F08A3C` `#B8322C`) ; texte foncé `#0B1422` sur les pastilles et les blocs, Z6 compris |

Panneaux : rayon 14 px. Chiffres : ombre portée légère `0 1px 2px rgba(5, 10, 20, .35)`.

Typographie (polices servies par l'application via `@fontsource`, jamais depuis Google Fonts) :

- **Barlow Condensed** 600 et 700 pour les chiffres, `tabular-nums` ;
- **Barlow** 500 à 700 pour les libellés ;
- tailles dans la scène 1280 × 720 : puissance 76, compte à rebours 64, mesures 38, pente 40, valeurs du panneau gauche 26, libellés 16. Le minimum de la planche de style est 16 px en 720p.

## Lisibilité

- Libellés (16 px) : contraste d'au moins **4,5:1** avec le fond du panneau composé sur le décor. Grands chiffres : au moins **3:1**.
- Mesurer sur les trois mondes (jour, couchant, nuit) avec la planche « Lisibilité », qui calcule le pire pixel derrière chaque panneau.
- Si un monde très clair passe sous le seuil, la variante « Clair adaptatif » (panneau clair et texte foncé quand le décor est lumineux) est la suite prévue, pas une teinte plus opaque partout.

## Données

| Affiché | Source |
|---|---|
| Puissance 3 s | `PowerAverage` sur les mesures du hub |
| FC, cadence | dernières mesures du hub, muettes après 3 s |
| Vitesse | vitesse virtuelle pendant la sortie, sinon celle mesurée par le trainer |
| Temps, distance, pente | `RideSnapshot` de la sortie virtuelle |
| Dénivelé positif | `ClimbCounter`, cumul des altitudes de la sortie |
| Prochain sommet, profil du tour | segments du parcours (`nextSummitM`, `routeProfile`) |
| Zone | `zoneOf` de `workout/profile.ts`, FTP de la séance ou saisie |
| Cible, écart, palier, profil de séance | `WorkoutState` du déroulement de séance, `profileShapes` |
| Liste « À suivre », n° de répétition | `upcoming`, `findSeries` et `repetitionAt` de `ui/hud-model.ts` (testés), intensité de la séance |

## À faire

- Mesurer le coût du flou au-dessus du canevas WebGPU sur un Android d'entrée de gamme ; sinon basculer en `flat` (`?quality=low` le fait déjà).
- Vérifier le contraste sur des captures du vrai rendu, pas seulement sur les maquettes.
- Téléphone en paysage : vérifier la taille des libellés à l'échelle réelle (vers 0,6 sur un écran de 800 px de large) ; au besoin, passer `--hud-k` à 1 sous une certaine largeur.
