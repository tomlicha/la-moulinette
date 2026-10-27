# Feuille de route

Mise à jour du 27 octobre 2026. Référence : [analyse technique](analyse-technique.md) (preuves de concept, exigences EF et ENF).

« Validé » veut dire essayé sur du vrai matériel. Le reste n'est vérifié que par des tests automatiques, ce qui ne prouve pas que le matériel se comporte pareil.

## Où on en est

| Domaine | État | Validé sur matériel ? |
|---|---|---|
| Connexion trainer (Web Bluetooth) | Fait : appairage, lecture de la puissance, reconnexion automatique | Oui sur un Wahoo KICKR |
| Pilotage ERG et SIM | Fait par le protocole propriétaire Wahoo ; ERG engageable et désengageable à tout moment | Oui sur le KICKR |
| Pilotage FTMS | Codé et testé sur un faux appareil | **Non** : le KICKR n'expose pas FTMS |
| Capteur de puissance seul | Fait : lecture, cadence déduite de la manivelle, cadence à 0 à l'arrêt | Oui sur un Stages (connexion) ; correction de cadence à confirmer |
| Ceinture cardio autonome | Codée, avec reconnexion | Oui sur un Garmin HRM-Pro+ : connexion, valeurs affichées, reconnexion (18,6 s, mais la ceinture était coupée pendant l'essai : le seuil de 5 s reste non mesuré) |
| Simulation physique | Fait : puissance, pente, air, roulement, inertie, freinage sans pédalage, parcours bouclé | Ressenti du SIM confirmé ; réglages à affiner |
| Rendu 3D | Première itération : monde, ombres en cascades, cycliste animé, caméra de poursuite, WebGPU et repli WebGL2 | WebGPU confirmé sur l'ordinateur de Tom ; **aucune mesure de performance** |
| Export FIT | Fait et testé avec le décodeur de Garmin | **Non** : bouton non essayé dans un navigateur |
| Envoi à Strava | Fait via un relais dans le serveur de dev | **Non** : jamais lancé avec de vrais identifiants |
| Tapis, capteur de foulée (seconde vague) | Non commencé | — |
| Multijoueur, backend, comptes | Non commencé | — |
| Coquille iOS (Capacitor) | Non commencée | — |
| Séances structurées (.zwo, .erg, .mrc) | Non commencé | — |

## Prochaines étapes

L'ordre suit le risque : on lève d'abord ce qui peut invalider l'architecture, pas ce qui est le plus facile.

### Étape 1. Fermer les inconnues de ce qui existe (court)

1. **Mesurer le rendu.** Relever la ligne de statistiques de la vue 3D (i/s, p50, p95, triangles) sur l'ordinateur de Tom, en WebGPU puis en WebGL2, pendant une sortie de plusieurs minutes. Cible : p95 ≤ 16,7 ms (ENF-02). C'est la première donnée réelle pour le PoC 2.
2. **Essayer l'export FIT** : faire une sortie, exporter, ouvrir le fichier dans un outil tiers. Ensuite, créer l'application Strava et tester l'envoi une fois.
3. **Couvrir plus de matériel.** Un trainer qui expose FTMS (une autre marque que Wahoo). Sans cela, le chemin FTMS, le socle de l'analyse, n'est jamais passé sur un vrai appareil (EF-01, EF-02, PoC 1).
4. **Affiner le ressenti** : freinage à l'arrêt, pente de départ de la boucle, vitesse virtuelle comparée à celle du trainer.

### Étape 2. Séances structurées (moyen, valeur directe)

Importer et exécuter des fichiers `.zwo`, `.erg` et `.mrc` (EF-05) : paliers, rampes, échauffements, avec la consigne envoyée en ERG. Le pilotage ERG existe déjà, il manque l'analyse des fichiers, l'exécution minutée et un HUD de séance. Les parseurs sont du TypeScript pur, testables sans matériel, avec un jeu de fichiers de référence.

### Étape 3. Rendu haute densité, PoC 2 complet (long)

C'est la plus grosse inconnue de l'analyse.
- Passer de la scène actuelle aux budgets de l'analyse : 50 coureurs d'environ 45 000 triangles, niveaux de détail générés, instanciation, décor en géométrie virtuelle (bibliothèque tierce ou réimplémentation).
- Ajouter la chaîne d'image : occlusion ambiante (GTAO), anticrénelage temporel, mise à l'échelle, lumière indirecte. Aujourd'hui il n'y a que des ombres en cascades.
- Départager Three.js et Babylon.js sur la même scène (critère de l'analyse).
- Mesurer sur les appareils planchers (iPhone 11, Android 2021, portable à GPU intégré) : 30 i/s stables pendant 60 min sur mobile, température et mémoire stables (ENF-01, ENF-07).
- Profils de qualité automatiques et baisse de profil en cas de dérive thermique.

### Étape 4. Coquille iOS, PoC 4 (à lancer tôt, en parallèle)

Le Bluetooth ne marche pas dans Safari : sans coquille native, il n'y a pas d'iOS. Le risque est le rejet de l'App Store (règle 4.2) et ses délais ne dépendent pas de nous.
- Coquille Capacitor, plugin BLE natif derrière la même interface SensorHub, HealthKit, build TestFlight soumis en revue.
- Vérifier au passage que WebGPU tourne dans la WebView iOS et Android (inconnue de l'analyse).
- Nécessite un compte développeur Apple et un iPhone.

### Étape 5. Multijoueur, PoC 3

Serveur de salles Colyseus, 200 coureurs simulés avec gestion d'intérêt, mesure de la bande passante par client mobile et du coût serveur (ENF-08). La simulation déterministe de `src/sim/` est déjà conçue pour tourner côté serveur. Ensuite : bots meneurs d'allure et fantômes (EF-12), courses arbitrées (EF-09).

### Étape 6. Produit

Comptes (OIDC), base PostgreSQL, hébergement avec région européenne, anglais et français, RGPD et données de santé, PWA installable, télémétrie (ENF-16), intégration continue avec budgets de taille et de performance, téléphone compagnon (EF-10), synchronisations Garmin, TrainingPeaks et intervals.icu (EF-07). La course à pied reste en seconde vague.

## Ce qui dépend de Tom

- **Mesures de performance** : la ligne de statistiques de la vue 3D sur chaque appareil disponible.
- **Matériel** : un trainer FTMS d'une autre marque, un iPhone (idéalement un iPhone 11), un Android milieu de gamme de 2021.
- **Comptes** : compte développeur Apple pour l'étape 4 ; application Strava pour tester l'envoi. Des sources tierces disent qu'un abonnement Strava est exigé pour les nouveaux développeurs depuis juin 2026 : à vérifier avant de créer l'application.
- **Demandes d'accès API** (action 5 de l'analyse) : Garmin Connect, TrainingPeaks, Wahoo. Les délais sont longs et indépendants de nous, donc à déposer maintenant même si l'intégration vient tard.

## Points ouverts

- **Strava en production** : le relais actuel n'existe que dans le serveur de dev. Un déploiement public demandera un vrai serveur pour garder le secret client.
- **Modèle physique** : pas d'aspiration, ni d'inertie des roues, ni de limite d'adhérence. L'aspiration devient nécessaire dès le multijoueur.
- **Géométrie virtuelle** : bibliothèque très jeune (une seule étoile GitHub). La décision adopter ou réimplémenter se prend dans l'étape 3.
