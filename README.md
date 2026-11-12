# La Moulinette

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

### Écrans et connexion au lancement

L'application a trois écrans : **Appareils** (toujours le premier au lancement), **Sortie** et **Séances**.

- Chaque appareil connecté (trainer, ceinture cardio) est mémorisé dans le navigateur. Au lancement, l'application tente de les retrouver et de s'y reconnecter seule, puis passe à la sortie quand le trainer et les autres appareils connus ont répondu.
- Cette reconnexion sans clic repose sur `navigator.bluetooth.getDevices()`, détecté à l'exécution. Le Chrome de test (novembre 2026) ne l'expose pas par défaut : l'écran propose alors « Reconnecter KICKR 81B5 », un clic par appareil, avec un sélecteur limité à cet appareil. La coquille Capacitor (BLE natif) permettra la reconnexion vraiment automatique.
- **Séances** : bibliothèque (mes séances, modèles, import `.zwo`/`.erg`/`.mrc`) et éditeur par blocs (échauffement, palier, intervalles, rampe, libre, retour au calme) avec aperçu du profil, durée, puissance moyenne, intensité et charge estimées, validation, export `.zwo`. Les séances sont gardées dans le navigateur (`localStorage`), pas encore synchronisées entre appareils.


### HUD de la sortie

Sur l'écran Sortie, les mesures sont posées sur la vue 3D : parcours ou palier en haut à gauche, puissance (moyenne 3 s), FC, cadence et vitesse en haut au centre, profil du parcours ou de la séance en bas. Panneaux en verre dépoli, police Barlow servie par l'application. `?quality=low` les passe sans flou. Spécification, décisions et jetons : [docs/design/hud.md](docs/design/hud.md).

### Journaux d'erreurs à distance

`src/telemetry/` : tout ce que la page écrit dans son journal (connexion au trainer, reconnexions, échecs de commande, erreurs non gérées du navigateur) est gardé en mémoire (300 dernières lignes). Dès qu'une ligne ressemble à une erreur, la page envoie le tampon au récepteur, 5 s plus tard pour y embarquer les essais de reconnexion qui suivent, avec le contexte (navigateur, trainer, état de connexion, capacités). Chaque ligne n'est envoyée qu'une fois ; au plus un envoi toutes les 30 s et vingt par session. Hors ligne, l'envoi repart au retour du réseau ou à la fermeture de la page. Les envois ne font jamais d'erreur visible et ne sont jamais journalisés eux-mêmes.

- **En développement** : rien à configurer. `npm run dev` reçoit les rapports dans `.logs/reports.jsonl` (ignoré par git).
- **À distance** : héberger `tools/log-server.ts` sur une machine joignable (VPS, Raspberry Pi derrière un tunnel…) :

  ```
  LOG_READ_TOKEN=<long et aléatoire> LOG_INGEST_TOKEN=<autre> npm run logs:serve
  ```

  puis construire l'application avec `VITE_LOG_ENDPOINT=https://hôte/api/logs/ingest` et `VITE_LOG_TOKEN=<LOG_INGEST_TOKEN>`. Sans `VITE_LOG_ENDPOINT`, un build de production n'envoie rien. Le jeton d'envoi est visible dans le code de la page : il écarte le bruit, il ne protège pas un secret. Seul `LOG_READ_TOKEN` donne accès aux rapports, il ne va jamais dans l'application. Restreindre `LOG_ALLOWED_ORIGIN` au domaine de l'application.
- **Relire** : `curl -H "Authorization: Bearer $LOG_READ_TOKEN" "https://hôte/api/logs/reports?limit=20&since=<ms>"` (JSON, du plus ancien au plus récent).

#### Récepteur gratuit sur Cloudflare (Workers + D1)

`worker/` rejoue le même récepteur (`src/telemetry/receiver.ts`) dans un Worker, avec D1 pour stockage : pas de serveur à maintenir, HTTPS inclus, offre gratuite largement suffisante pour quelques rapports par session. D1 plutôt que KV : KV ne liste pas du plus récent au plus ancien, et un Worker gratuit ne fait qu'environ 50 appels par requête, ce qui limiterait la relecture. Les rapports de plus de 30 jours sont purgés chaque nuit.

```
npx wrangler login
npx wrangler d1 create zwift2-logs          # copier database_id dans wrangler.toml
npx wrangler d1 migrations apply zwift2-logs --remote
npx wrangler secret put INGEST_TOKEN        # jeton d'envoi, le même que VITE_LOG_TOKEN
npx wrangler secret put READ_TOKEN          # jeton de lecture, jamais dans l'application
npx wrangler deploy                         # affiche https://zwift2-logs.<compte>.workers.dev
```

Puis `VITE_LOG_ENDPOINT=https://zwift2-logs.<compte>.workers.dev/api/logs/ingest` au build de l'application, et `ALLOWED_ORIGIN` de `wrangler.toml` au domaine de l'application. La relecture par `curl` est la même que ci-dessus. Le jeton d'envoi étant public, une règle de limitation de débit (Cloudflare, tableau de bord > Sécurité > WAF) protège le quota gratuit d'un envoi massif. Vérifié en local avec `wrangler dev` (D1 simulé) et par tests ; pas encore déployé sur un vrai compte.

Le récepteur (`receiver.ts`) reste un gestionnaire `Request` vers `Response` indépendant de Node et de Cloudflare : un autre `LogStore` suffit pour l'héberger ailleurs. Les rapports contiennent le nom de l'appareil Bluetooth et le navigateur, pas de position ni de compte ; le rapport est lisible par quiconque détient le jeton de lecture. Vérifié : tests unitaires, serveur autonome et serveur de dev avec `curl`. Non vérifié : un envoi réel depuis la page avec un vrai trainer.
