# zwift-2

App d'entraînement home trainer (cyclisme, puis course à pied), avec rendu 3D, capteurs Bluetooth et multijoueur.

Point de départ : [docs/analyse-technique.md](docs/analyse-technique.md), l'évaluation technologique des 26 et 27 octobre 2026.
État d'avancement et prochaines étapes : [docs/roadmap.md](docs/roadmap.md).
Source : https://claude.ai/artifact/DNwZzib59Z5B9rMruVJT1S

Orientation retenue : un cœur web unique en TypeScript (Three.js, WebGPU avec repli WebGL2), livré en PWA sur ordinateur et Android, et dans une coquille Capacitor sur iOS et Android. Pas d'app TV.

## PoC : connexion au home trainer

Premier PoC de l'analyse (PoC 1, capteurs), réduit à la connexion : appairage Web Bluetooth, lecture puissance, cadence, vitesse et cardio, pilotage ERG et SIM via FTMS.

```
npm install
npm run dev      # http://localhost:5173 dans Chrome ou Edge
npm test         # décodeurs et encodeurs de trames
```

- `src/sensors/decoders.ts`, `control-point.ts` : décodage et encodage des trames FTMS, Cycling Power et Heart Rate, en TypeScript pur.
- `src/sensors/web-bluetooth.ts` : adaptateur Web Bluetooth ; repli en lecture seule sur Cycling Power si FTMS est absent.
- `src/sensors/simulator.ts` : trainer simulé, pour développer sans matériel.
- Le journal de la page affiche les trames du Control Point et du Machine Status : à copier dans la matrice de compatibilité par modèle de trainer.

Web Bluetooth exige Chrome ou Edge et un contexte sécurisé (localhost ou HTTPS). Pour tester depuis un téléphone Android, exposer le serveur en HTTPS (tunnel ou certificat local).

### Résultat du PoC

| Trainer | Transport | Lecture | ERG | SIM | Notes |
|---|---|---|---|---|---|
| Wahoo KICKR (81B5) | Web Bluetooth, Chrome (Windows) | Cycling Power (1818) | oui | oui | Pas de FTMS exposé : contrôle par le service propriétaire Wahoo (`a026ee01…`, opcodes 0x42, 0x43, 0x46). Cache Bluetooth Windows à vider si les services paraissent obsolètes. |

Reconnexion automatique (coupure du KICKR en cours d'ERG) : 3,4 s et 3,7 s, du premier coup, avec rejeu de la consigne ERG (réponse du trainer : succès). Exigence ENF-06 : moins de 5 s. Deux mesures seulement ; presque tout le temps est pris par la connexion GATT et la découverte des services.

Le protocole Wahoo est repris du code de GoldenCheetah, sans documentation officielle. Il faut tester les autres marques en FTMS (voir la matrice de compatibilité de l'analyse).

### Sortie virtuelle et physique

`src/sim/` : modèle physique vélo (puissance, pente, air, roulement, inertie), parcours bouclé et sortie à pas fixe de 50 ms, déterministe et sans dépendance au DOM, donc réutilisable côté serveur. Sur la page, « Démarrer la sortie » fait avancer ce modèle avec la puissance mesurée et renvoie la pente du parcours au trainer en mode SIM. Aspiration, inertie des roues et limite d'adhérence ne sont pas encore modélisées.

`src/sensors/hub.ts` fusionne le trainer et la ceinture cardio ; les deux se reconnectent seuls après une coupure (60 s maximum).

### Export FIT, intervals.icu et Strava

`src/export/` : la sortie est enregistrée à 1 Hz (puissance, cadence, cardio, et vitesse, distance, altitude quand la sortie virtuelle tourne), en pause quand le trainer est déconnecté. « Exporter FIT » télécharge un fichier FIT Activity encodé avec le SDK officiel de Garmin (`@garmin/fitsdk`), chargé seulement à l'export.

Envoi à intervals.icu, sans abonnement, depuis le serveur de dev uniquement :

1. Sur https://intervals.icu/settings, tout en bas, copier la clé d'API personnelle.
2. Copier `.env.example` en `.env.local` et renseigner `INTERVALS_API_KEY` (le fichier n'est jamais commité).
3. Relancer `npm run dev` : le bouton « Envoyer à intervals.icu » apparaît. Il dépose le fichier FIT et le journal affiche le lien de l'activité.

La clé reste dans le relais du serveur Vite (`src/export/intervals/relay.ts`) et n'est jamais envoyée au navigateur ; ne la colle ni dans le code ni dans une conversation. intervals.icu écarte les fichiers en double : renvoyer la même sortie ne crée rien de plus. Le dépôt est fait d'après la documentation d'intervals.icu (`POST /api/v1/athlete/0/activities`, authentification basique `API_KEY`) ; validé de bout en bout sur un vrai compte le 27 octobre 2026 : activité créée (type `VirtualRide`, source `UPLOAD`, puissance et distance présentes), renvoi du même fichier détecté comme doublon sans rien créer, suppression de l'activité de test.

Envoi à Strava, depuis le serveur de dev uniquement :

1. Créer une application sur https://www.strava.com/settings/api avec « Authorization Callback Domain » = `localhost`.
2. Copier `.env.example` en `.env.local` et renseigner `STRAVA_CLIENT_ID` et `STRAVA_CLIENT_SECRET`.
3. `npm run dev`, puis « Envoyer à Strava » : la première fois, une fenêtre Strava demande l'autorisation (`activity:write`).

Strava exige le `client_secret` pour l'échange et le rafraîchissement des jetons, et sa documentation ne prévoit pas PKCE : le secret ne peut pas vivre dans le navigateur. Un relais dans le serveur Vite (`src/export/strava/relay.ts`) garde donc le secret et les jetons (`.strava-tokens.json`, ignoré par le dépôt) ; la page ne parle qu'à `localhost`. Les variables `STRAVA_*` n'ont pas le préfixe `VITE_` et ne sont jamais envoyées au navigateur. Un déploiement public demandera de rejouer ce relais sur un vrai serveur : le gestionnaire de routes est indépendant de Vite (`Request` vers `Response`), seul le magasin de jetons et l'adaptateur de `vite.config.ts` sont à remplacer.

Depuis le 1er juin 2026, un compte Strava avec abonnement payant est exigé pour créer une nouvelle application (niveau Standard ; les anciennes applications dès le 30 juin). Plusieurs médias le rapportent, avec un prix de 11,99 $ par mois aux États-Unis ; nous ne l'avons pas relu dans la documentation officielle. Une application Standard sert un athlète par défaut, et jusqu'à dix selon les sources : le palier réel de l'application s'affiche sur https://www.strava.com/settings/api.

Validé : l'export FIT dans la vraie page (fichier relu avec le décodeur de Garmin : intégrité, 0 erreur, puissance, cadence, cardio, vitesse, distance, altitude, sport `cycling` et sous-sport `virtualActivity`). Non validé : l'envoi lui-même, jamais lancé avec de vrais identifiants.

### Séances structurées

`src/workout/` : lecture des fichiers `.zwo` (Zwift), `.erg` (watts) et `.mrc` (% de FTP), en TypeScript pur et sans DOM ; déroulement minuté de la séance ; consigne envoyée au trainer en ERG (immédiatement à chaque palier, au plus une fois par seconde pendant une rampe). Fichiers de référence dans `samples/workouts/`, également proposés dans la page (« Séance d'exemple »).

Sur la page : charger un fichier ou l'exemple, régler la FTP (mémorisée dans le navigateur), puis « Démarrer la séance ». Pause, palier suivant, arrêt et intensité ±5 % sont disponibles en cours de route. Un palier libre (`FreeRide`, `MaxEffort`) relâche l'ERG, qui est repris au palier suivant. Désengager l'ERG à la main laisse la séance continuer sans consigne ; le réengager lui rend la main. Le temps de séance s'arrête quand le trainer est déconnecté.

Vérifié dans la vraie page avec le trainer simulé ; pas encore sur le KICKR.

