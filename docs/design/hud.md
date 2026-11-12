# HUD de la sortie

Référence permanente du HUD affiché par-dessus la vue 3D (écran **Sortie**, voir [sortie.md](sortie.md) pour l'écran lui-même). Toute évolution du HUD part de ce fichier et le met à jour.

- Code : [`src/ui/hud.ts`](../../src/ui/hud.ts) (affichage), [`src/ui/hud.css`](../../src/ui/hud.css) (style), [`src/ui/hud-model.ts`](../../src/ui/hud-model.ts) (calculs purs, testés).
- Branchement : `renderHud()` dans [`src/main.ts`](../../src/main.ts), rafraîchi à 4 Hz tant que l'écran Sortie est affiché.
- Planches de travail (claude.ai) : [trois propositions](https://claude.ai/artifact/749sgeL3BqXciEr1dpn4q2), [lisibilité](https://claude.ai/artifact/BwzRiDrk5v9ZZM63hjqmaK). Direction graphique d'origine : [Direction graphique](https://claude.ai/artifact/XsuzQxwA5WEKoyn8Jxu4nP), planches Main, Erg et Style.

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-11 | Proposition **A · Panneaux** retenue, face à « Compteur » (un bloc dans un coin) et « Flottant » (chiffres sans panneau). | Reprend la maquette validée ; chaque information a une place fixe, la même en sortie libre et en séance. |
| 2026-11-11 | Puissance regroupée avec FC, cadence et vitesse dans un seul bloc en haut au centre ; puissance dominante ; altitude retirée. | Un seul endroit à regarder, juste au-dessus du cycliste. L'altitude n'aide pas à rouler ; le dénivelé cumulé et la pente suffisent. |
| 2026-11-11 | Widgets réduits à 90 % (`--hud-k`). | Moins de scène masquée, lisibilité intacte. |
| 2026-11-11 | Cartes de mesures sous la vue retirées ; HUD complet affiché dès l'écran Sortie ; téléphone en paysage uniquement. | Le HUD est l'affichage unique ; pas de saut de mise en page au départ de la sortie. |
| 2026-11-12 | La sortie passe **plein écran** : le HUD couvre la fenêtre, sa scène 1280 × 720 est ajustée et centrée ; le message de la séance s'y affiche. | Voir [sortie.md](sortie.md). |
| 2026-11-11 | **Verre dépoli** retenu pour la lisibilité, face à « Bandeau opaque » et « Clair adaptatif ». | Le gris translucide laissait passer le ciel clair : libellés gris clair autour de 2,5:1 devant les nuages (calcul à la main, à remesurer dans la planche « Lisibilité »). Le flou supprime les contours nets sous le texte ; la teinte plus dense et les libellés éclaircis remontent le contraste, sans changer l'esprit de la maquette. |

## Repère et mise en page

Le HUD est mis en page dans une scène fixe de **1280 × 720 px**, puis ajustée à la fenêtre : `--hud-s` = le plus petit de largeur / 1280 et hauteur / 720, et la scène est centrée (`--hud-x`, `--hud-y`). Le HUD couvre toute la fenêtre hors zones sûres ; sur un écran plus large ou plus haut que 16:9, les panneaux restent à leur taille et gardent leurs marges. Les panneaux sont ensuite réduits à 90 % (`--hud-k`) autour de leur point d'ancrage, qui les garde collés à leur bord.

| Panneau | Position (scène 1280 × 720) | Ancrage du 90 % | Contenu |
|---|---|---|---|
| Gauche | x 64, y 36, l 250 | haut gauche | Sortie libre : nom du parcours, temps, distance, dénivelé positif. Séance : palier (type, n° / total), compte à rebours, barre de progression, temps fait / durée, cadence visée. |
| Centre | x 340, y 36, l 600 | haut centre | Puissance 3 s (76 px), séparateur, puis trois colonnes à 38 px : FC, cadence, vitesse (sortie libre) ou cible, FC, cadence (séance). Barre de zones. Ligne du bas : pastille de zone et % de la FTP, ou en séance pastille de zone, ERG, écart, plage cible ± 5 %. |
| Bas | x 64, y 596, l 1152, h 90 | bas centre | Sortie libre : pente, profil du tour avec position, prochain sommet en pointillé, mode SIM ou ERG, état du trainer et de la ceinture. Séance : nom, temps fait / total, palier suivant, profil de la séance avec curseur, paliers passés atténués. |
| Message | x 340, y 214, l 600 | haut centre | Message de la séance en cours (consigne du fichier), sous le panneau central ; absent sans message. |
| Haut droit | libre | | Bouton du menu de la sortie ; réservé en dessous à la liste du groupe (multijoueur). Le compteur de rendu (`view-stats`), masqué par défaut, s'y affiche si on le demande dans le menu. |

États :

- **Sortie libre**, y compris avant le départ : les trois panneaux, version sortie. Avant le départ, le parcours et la pente sont en « – », le profil montre le départ et le premier sommet ; le HUD ne change donc pas de forme au démarrage.
- **Séance** : les trois panneaux, version séance ; la vitesse sort du bloc central pour laisser la place à la cible.

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
| `--hz1` … `--hz6` | `#8C99A8` `#3B82D6` `#2FA36B` `#F2C230` `#F08A3C` `#B8322C` | zones de puissance de la planche de style ; texte foncé `#0B1422` sur les pastilles, blanc sur Z6 |

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

## À faire

- Mesurer le coût du flou au-dessus du canevas WebGPU sur un Android d'entrée de gamme ; sinon basculer en `flat` (`?quality=low` le fait déjà).
- Vérifier le contraste sur des captures du vrai rendu, pas seulement sur les maquettes.
- Téléphone en paysage : vérifier la taille des libellés à l'échelle réelle (vers 0,6 sur un écran de 800 px de large) ; au besoin, passer `--hud-k` à 1 sous une certaine largeur.
