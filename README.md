# zwift-2

App d'entraînement home trainer (cyclisme, puis course à pied), avec rendu 3D, capteurs Bluetooth et multijoueur.

Point de départ : [docs/analyse-technique.md](docs/analyse-technique.md), l'évaluation technologique des 26 et 27 octobre 2026.
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
