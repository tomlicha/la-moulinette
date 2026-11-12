# Éditeur de séance

Référence permanente de l'éditeur de séance (écran **Séances**, bouton « Nouvelle séance » ou « Modifier »). Toute évolution de l'éditeur part de ce fichier et le met à jour.

- Code : [`src/ui/workout-editor.ts`](../../src/ui/workout-editor.ts) (affichage et gestes), [`src/ui/editor.css`](../../src/ui/editor.css) (style), balisage dans [`index.html`](../../index.html) (`#editor`). Logique pure, testée : [`src/workout/block-ops.ts`](../../src/workout/block-ops.ts), [`src/workout/blocks.ts`](../../src/workout/blocks.ts), [`src/workout/history.ts`](../../src/workout/history.ts).
- Branchement : `setupWorkoutEditor()` dans [`src/main.ts`](../../src/main.ts) ; « Rouler » appelle `onRide`.
- Maquettes (claude.ai) : [Direction graphique](https://claude.ai/artifact/XsuzQxwA5WEKoyn8Jxu4nP), rangée « Éditeur de séance plein écran » : E1 Atelier, E2 Piste, E3 Recette. Retenue : **E1 · Atelier**.

## Décisions

| Date | Décision | Pourquoi |
|---|---|---|
| 2026-11-12 | Proposition **E1 · Atelier** retenue, face à E2 (profil en relief sur toute la largeur, réglages dans une bulle) et E3 (une phrase par étape, valeurs touchables). | Garde toutes les fonctions de l'ancien éditeur et rend le profil directement modifiable ; la plus lisible sur ordinateur et télé. |
| 2026-11-12 | Éditeur **plein écran**, dans la direction de l'accueil : scène floutée derrière, panneaux de verre, accent menthe, Barlow Condensed. La barre du haut est masquée tant qu'il est ouvert ; « Séances » le referme. | Un éditeur est un atelier : toute la place va au profil, comme l'accueil donne toute la place au monde. |
| 2026-11-12 | **Poignées sur le profil** : le haut du bloc choisi règle la puissance (pas de 1 %), son bord droit la durée (pas de 15 s). Pour des intervalles, elles agissent sur l'effort ; la première répétition est encadrée, les autres en pointillés. | On modifie la séance là où on la regarde. Les pas sont ceux du clavier pour la durée ; la puissance suit le doigt au plus près. |
| 2026-11-12 | **Palette** des six blocs à gauche, avec leur forme et leurs valeurs par défaut : la toucher ajoute après le bloc choisi, la glisser sur le profil insère à la jointure la plus proche (repère « Insérer ici »). | Ajouter un bloc devient un geste visible au lieu d'une rangée de puces sous l'éditeur. |
| 2026-11-12 | « Rouler » enregistre, ferme l'éditeur, choisit la séance et la démarre dans la sortie (sauf si une séance est déjà en cours). Description et export .zwo passent dans le menu « ⋯ ». | Même verbe et même effet que le bouton Rouler de l'accueil. |

## Mise en page

Repère de conception : **1280 × 720**, la même scène que les maquettes. Marges 20 px en haut et en bas, 24 px sur les côtés ; 16 px entre panneaux.

| Zone | Taille | Contenu |
|---|---|---|
| Barre du haut | hauteur 52 | Séances (retour), logo, nom de la séance (+ « Non enregistrée »), annuler / rétablir / ⋯, Enregistrer, **Rouler**. |
| Palette | largeur 196 | « Ajouter un bloc », six tuiles (forme, nom, valeurs par défaut), mode d'emploi, raccourcis clavier. |
| Profil | reste de la largeur, toute la hauteur restante | Axe en % et W, bandes de zones, ligne de FTP, cadre et poignées du bloc choisi, info-bulle au survol, bande de structure (avec « + » d'insertion), axe du temps. |
| Résumé | sous le profil | Durée, moyenne, intensité, charge (avec l'écart depuis la version enregistrée), barre et liste du temps par zone, phrase de lecture, erreurs. |
| Réglages | largeur 312 | « Bloc n sur N », type, pastille de zone, phrase du bloc, champs à boutons − / + regroupés et teintés par zone, cadence cible, Avant / Après / Dupliquer, Séparer / Supprimer. |

Pendant un glissé, l'échelle du profil (durée totale, haut de l'axe) est figée sur celle du début du geste, sinon le bloc fuirait sous le doigt ; tout le geste compte pour une seule annulation.

Écrans plus petits : sous 1180 px de large ou 640 px de haut, la page défile et le profil passe à 280 px ; sous 1180 px, la palette passe en ligne au-dessus et le logo disparaît ; sous 760 px, une seule colonne. Le téléphone est utilisé en paysage uniquement.

## Jetons

Couleurs fixes, comme le HUD et l'accueil : l'éditeur reste sombre quel que soit le thème.

| Jeton | Valeur | Usage |
|---|---|---|
| `--glass` | `rgba(11, 20, 34, .78)` + flou 16 px | Fond des panneaux |
| `--glass-line` | `rgba(255, 255, 255, .14)` | Bordure des panneaux |
| `--glass-muted` | `#D3DCE8` | Libellés en capitales, textes secondaires |
| `--accent` | `#5BE3C9` (texte `#0B1422`) | Rouler, poignées, cadre du bloc choisi, bloc choisi dans la bande |
| `--dirty` | `#FFD27A` | « Non enregistrée » |
| `--err` | `#FF8A85` | Supprimer, erreurs |
| `--z1` … `--z6` | valeurs du mode sombre de `style.css` | Profil, palette, groupes de réglages, temps par zone |

Fond : la scène « Col des Érables » de l'accueil, floutée à 10 px sous un voile `rgba(11, 20, 34, .55 → .72)`. Ses identifiants SVG sont préfixés `ed-` (le même dessin existe dans l'accueil caché).

## À faire

- Le glisser-déposer depuis la palette passe par le glisser-déposer HTML : il ne marche pas partout au doigt. Sur tablette, toucher la tuile (ajout après le bloc choisi) ou le « + » de la bande reste le chemin sûr.
- Modèles de séance accessibles depuis l'éditeur (aujourd'hui seulement dans la bibliothèque).
- Scène de fond : suivre celle affichée sur l'accueil plutôt qu'une scène fixe.
