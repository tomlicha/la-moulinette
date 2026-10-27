# App d'entraînement home trainer — Évaluation technologique

## Résumé exécutif

Recommandation : un cœur web unique en TypeScript (rendu Three.js en WebGPU, simulation et capteurs découplés), livré en PWA sur ordinateur et Android, et dans une coquille Capacitor sur iOS et Android. Depuis le 27 octobre, les smart TV sont hors périmètre : leur matériel bridait le rendu. Un grand écran reste possible par recopie (AirPlay, Cast) ou HDMI, sans app TV. Le facteur dimensionnant devient la qualité d'image sur mobile, avec le Bluetooth : seuls Chrome et Edge (ordinateur, Android) parlent aux capteurs depuis le web.

> *Schéma : architecture recommandée · 2 coquilles, 1 cœur, 3 services (voir le document d'origine)*

Les capteurs atteignent l'application directement dans Chrome/Edge et dans la coquille native ; le grand écran ne fait qu'afficher l'image d'un téléphone, d'une tablette ou d'un ordinateur.

### Décisions structurantes

1. **Rendu** : Three.js r186, `WebGPURenderer` en WebGPU d'abord avec repli WebGL2 ; 3D stylisée à formes arrondies et ombres temps réel ; géométrie virtuelle pour le décor, niveaux de détail générés pour les coureurs ; 60 images/s sur ordinateur, 30 (60 visé) sur mobile.
2. **Capteurs** : FTMS comme socle (modes ERG et SIM) ; interface SensorHub à adaptateurs (Web Bluetooth, BLE natif, relais, simulateur).
3. **Livraison** : PWA + Capacitor (iOS, Android) ; aucune app TV : smart TV, boîtiers TV et Apple TV sont servis par recopie (AirPlay, Cast) ou HDMI.
4. **Temps réel** : WebSocket binaire, salles Colyseus ; chaque client fait foi pour son mouvement, le serveur arbitre les courses.
5. **Backend** : TypeScript, PostgreSQL, stockage objet, Redis ; demandes d'accès Strava, Garmin et TrainingPeaks à déposer dès maintenant.
6. **Plancher matériel** : iPhone 11 (iOS 26), Android milieu de gamme 2021, ordinateur à GPU intégré récent (Intel Iris Xe, Apple M1) ; en dessous, profil de repli WebGL2.

Trois preuves de concept doivent précéder le gel des exigences : rendu haute densité sur les appareils planchers (Three.js contre Babylon.js), connexion capteurs sur trois marques et en natif iOS, coquille iOS soumise en revue (détail dans la section des risques).

**Maquettes graphiques** : [Direction graphique — app home trainer](https://claude.ai/artifact/XsuzQxwA5WEKoyn8Jxu4nP), avec trois scènes 3D et leur HUD (sortie libre, séance ERG, course), une planche de style et l'écran du téléphone compagnon.

## Contexte, hypothèses et contraintes

L'application doit offrir, dans un navigateur, l'expérience d'un monde virtuel parcouru sur home trainer (vélo) ou tapis (course), sur téléphone, tablette et ordinateur. Les smart TV ne sont plus ciblées ; un téléviseur sert au besoin d'écran, par recopie ou HDMI. Les contraintes dimensionnantes sont la qualité d'image sur un mobile milieu de gamme et la connexion Bluetooth aux capteurs, que tous les navigateurs ne permettent pas.

### Périmètre fonctionnel supposé

- Vélo sur home trainer connecté (« smart trainer ») au lancement ; course sur tapis connecté ou avec capteur de foulée en seconde vague.
- Monde 3D parcouru en temps réel, avatar personnalisable, autres utilisateurs visibles.
- Modes : sortie libre, séances structurées (mode ERG), sorties de groupe et courses.
- Pilotage de la résistance du home trainer : pente simulée (mode SIM) ou puissance cible (mode ERG).
- Export des activités (fichier FIT) et synchronisation vers Strava, Garmin Connect, TrainingPeaks.

### Contraintes posées

- Une seule base de code web, installable comme application (PWA) quand la plateforme le permet.
- Graphismes 3D stylisés de qualité (formes arrondies, ombres temps réel, coureurs détaillés) : la géométrie n'est pas réduite à la main, le moteur adapte le détail à l'écran.
- Aucune app pour smart TV ni boîtier TV : leur matériel et leurs moteurs web figés brideraient le rendu de toutes les plateformes.

### Classe de matériel de référence (à valider)

| Cible | Appareil plancher proposé | Objectif |
|---|---|---|
| Smartphone, tablette | iPhone 11 (iOS 26), Android 12+ milieu de gamme 2021 (GPU Adreno 6xx, Mali-G57) | WebGPU, 30 images/s, 60 visé |
| Ordinateur | Portable à GPU intégré récent (Intel Iris Xe, AMD Radeon 680M, Apple M1) | WebGPU, 60 images/s en 1080p |
| Ordinateur ancien (Intel UHD 620) ou navigateur sans WebGPU | — | Profil de repli WebGL2, 30 images/s |
| Téléviseur | Hors périmètre : recopie (AirPlay, Cast) ou HDMI depuis un appareil ci-dessus | — |

### Décisions des 26 et 27 octobre 2026

| Sujet | Décision | Conséquence |
|---|---|---|
| Smart TV et boîtiers TV (27 oct.) | Exclus : leur matériel et leurs moteurs web figés bridaient le rendu | Aucun paquet Tizen, webOS, Android TV ni Fire TV ; grand écran par recopie ou HDMI ; WebGPU d'abord |
| Moteur de rendu (27 oct.) | Qualité d'image prioritaire, sans réduire les triangles à la main : Three.js r186 en WebGPU, géométrie virtuelle, niveaux de détail générés ; Babylon.js 9 en alternative | Preuve de concept de rendu comparative avant le gel des exigences |
| Apple TV | Pas d'app dédiée : recopie AirPlay depuis l'iPhone ou l'iPad | Aucun client tvOS à développer |
| Équipe | Développement assuré par Claude ; le porteur du projet fournit le matériel, les comptes développeur (Apple, Google), les demandes d'accès API, les tests physiques et les soumissions aux stores | Stack web/TypeScript confirmée ; décor généré en code |
| Course à pied | Seconde vague | Lancement vélo seul ; protocoles de course déjà prévus dans SensorHub |
| Participants simultanés | 50 par monde au lancement | Salles dimensionnées pour 50 ; montée en charge par ajout de salles et d'instances |
| Mode hors ligne | Non | Connexion requise ; seule une coupure courte est tolérée sans perte de la sortie |
| Langues et marchés | Anglais et français ; Europe envisagée | RGPD intégré dès la conception, hébergement avec région européenne possible |
| Modèle économique | Gratuit, sans abonnement pour l'instant | Aucun paiement au lancement ; module de paiement ajoutable plus tard |
| Plancher ordinateur (27 oct.) | Relevé à un GPU intégré récent : Intel Iris Xe, AMD Radeon 680M, Apple M1 | Portables Intel UHD 620 et plus anciens servis par le profil de repli WebGL2, à 30 images/s |

Aucune question ouverte à ce stade ; les seuils chiffrés restent à confirmer par les preuves de concept.

## Matrice des plateformes cibles

Le navigateur suffit sur ordinateur et Android ; iOS exige une coquille native pour le Bluetooth. Toutes ces cibles exposent WebGPU. Les smart TV, boîtiers TV et l'Apple TV ne sont plus ciblés : un téléviseur sert d'écran par recopie ou HDMI.

| Plateforme | Moteur web | Rendu 3D disponible | Accès aux capteurs Bluetooth | Distribution | Verdict |
|---|---|---|---|---|---|
| Ordinateur (Windows, macOS, ChromeOS) | Chrome, Edge, Firefox, Safari à jour | WebGPU sur Chrome/Edge, Safari 26, Firefox Windows et Mac Apple Silicon ; WebGL2 partout | Web Bluetooth natif dans Chrome, Edge, Opera ; absent de Firefox et Safari | URL + PWA installable ; Electron ou Tauri en option | Web pur |
| Android (téléphone, tablette) | Chrome Android, Samsung Internet | WebGPU sur Android 12+ (GPU Qualcomm/ARM) ; WebGL2 | Web Bluetooth natif dans Chrome et Samsung Internet | PWA, ou Play Store via Capacitor | Web pur, coquille en option |
| iPhone, iPad | WebKit imposé à tous les navigateurs | WebGPU depuis iOS 26, activé par défaut aussi dans WKWebView ; WebGL2 | Aucun Web Bluetooth dans Safari ; navigateur tiers Bluefy ou extension Safari WebBLE (iOS 26+) | App Store via coquille native | Hybride obligatoire |
| Grand écran (smart TV, boîtier TV, Apple TV) | Aucun utilisé | Celui de l'appareil source | Lus par l'appareil source | Aucune | Hors périmètre : recopie AirPlay ou Cast, ou HDMI |

### Conséquences pour le cahier des charges

- **WebGPU comme socle de rendu, WebGL2 en repli.** Toutes les cibles retenues exposent WebGPU ; le repli WebGL2 couvre Firefox Android et Linux et les appareils anciens. La disponibilité de WebGPU dans la WebView Android de la coquille Capacitor est à confirmer en preuve de concept.
- **Un seul profil de build moderne (ES2022).** Plus de transpilation ES2020 pour des moteurs de TV figés.
- **Le Bluetooth décide de l'architecture.** Seuls Chrome/Edge (ordinateur, Android) parlent directement aux capteurs depuis le web ; iOS passe par la coquille native, Safari et Firefox sur ordinateur par le téléphone compagnon.
- **Le grand écran passe par la recopie.** AirPlay depuis iPhone ou iPad, Cast depuis Android ou Chrome, ou HDMI depuis un ordinateur : rendu et capteurs restent sur l'appareil source. La recopie sans fil ajoute un peu de latence d'image ; le HDMI reste l'option la plus nette.

Sources : [prise en charge de WebGPU par navigateur](https://www.utsubo.com/blog/threejs-2026-what-changed) · [WebGPU dans WKWebView (forum Apple)](https://developer.apple.com/forums/thread/770862) · [Web Bluetooth (caniuse)](https://caniuse.com/web-bluetooth) · [état WebGPU](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)

## Connectivité des capteurs

Le protocole Bluetooth FTMS (Fitness Machine Service) doit être le socle : il couvre home trainers et tapis, en lecture comme en pilotage. Les profils historiques complètent pour les capteurs simples, et une couche d'abstraction isole l'app du mode de transport (Web Bluetooth, natif, pont).

### Profils Bluetooth à supporter

| Service BLE | UUID | Usage | Priorité |
|---|---|---|---|
| Fitness Machine Service (FTMS) | 0x1826 | Home trainers et tapis : données (Indoor Bike Data 0x2AD2, Treadmill Data 0x2ACD), état (0x2ADA), pilotage via Control Point (0x2AD9) | Indispensable |
| Cycling Power Service | 0x1818 | Capteurs de puissance (pédales, manivelles), home trainers anciens | Indispensable |
| Heart Rate Service | 0x180D | Ceintures et montres cardio | Indispensable |
| Cycling Speed and Cadence | 0x1816 | Vitesse/cadence sur home trainer non connecté (puissance virtuelle estimée) | Indispensable |
| Running Speed and Cadence | 0x1814 | Capteurs de foulée pour tapis non connectés | Seconde vague (course) |
| Protocoles propriétaires | — | Tacx FE-C sur BLE, ancien contrôle Wahoo, manettes de jeu au guidon | Seconde vague |

### Pilotage du home trainer via FTMS

- **Prise de contrôle** : écrire Request Control (opcode 0x00) sur le Control Point ; sans cela, certains appareils n'envoient aucune notification.
- **Mode ERG** : Set Target Power (0x05), la résistance suit une puissance cible quelle que soit la cadence.
- **Mode SIM (pente)** : Set Indoor Bike Simulation Parameters (0x11), avec pente, vent, coefficients de roulement et de traînée.
- **Tapis** : Set Target Speed (0x02) et Set Target Inclination (0x03) pour suivre le relief, à n'activer qu'avec confirmation explicite (sécurité).
- **Réponses** : chaque commande renvoie un code 0x80 suivi du résultat ; prévoir les cas « contrôle refusé » et « contrôle perdu ».

### Stratégies de connexion

| Stratégie | Où elle s'applique | Avantages | Limites |
|---|---|---|---|
| Web Bluetooth direct | Chrome/Edge ordinateur, Chrome Android | Aucune installation | Absent d'iOS, de Safari et de Firefox ; `getDevices()` désactivé par défaut, donc re-sélection manuelle à chaque session ; API indisponible en Web Worker |
| Plugin BLE natif dans une enveloppe (Capacitor) | iOS, Android | Reconnexion automatique, fonctionnement écran verrouillé, multi-capteurs | Passage par les stores |
| Pont smartphone (« companion ») | Safari et Firefox sur ordinateur (sans Web Bluetooth) | Le téléphone lit les capteurs et relaie vers l'écran par le réseau | Latence et fiabilité dépendantes du Wi-Fi ; Zwift utilise ce schéma pour l'Apple TV avec des retours mitigés |
| Navigateur iOS tiers (Bluefy, extension Safari WebBLE) | iOS | Pas d'app native à publier | Dépendance à un tiers, parcours d'installation dégradé : acceptable pour un prototype, pas pour le grand public |
| Connexion réseau Direct Connect (DIRCON) | Home trainers compatibles en Wi-Fi ou Ethernet | Plus stable que le Bluetooth, ne consomme pas de canal BLE | Nécessite TCP brut et découverte mDNS, donc une couche native |
| ANT+ via WebUSB et clé USB | Chrome ordinateur | Couvre les home trainers ANT+ FE-C anciens | Matériel supplémentaire, public de niche |

### Exigences d'architecture qui en découlent

- Une interface unique « SensorHub » (découverte, connexion, flux de mesures, commandes) avec un adaptateur par transport : Web Bluetooth, plugin natif, pont réseau, DIRCON, simulateur.
- Un simulateur de capteurs (puissance, cadence, cardio scriptés) pour développer et tester sans matériel.
- Le décodage des trames FTMS/CPS en TypeScript pur, partagé entre le client web, l'enveloppe native et le pont.
- Une gestion explicite de la perte de signal : gel de l'avatar, reconnexion automatique, indicateur visible.
- Une matrice de compatibilité matérielle publiée (marques et modèles testés).

Sources : [Web Bluetooth et getDevices (caniuse)](https://caniuse.com/mdn-api_bluetooth_getdevices) · [spécification FTMS (Bluetooth SIG)](https://files.bluetooth.com/download/ftms_v1-0-1) · [UUID FTMS observés sur un trainer](https://forums.garmin.com/developer/connect-iq/f/discussion/282112/ble-notification-not-appearing-for-ftms-ble/1354883) · [Bluefy](https://apps.apple.com/app/id1492822055) · [extension WebBLE](https://apps.apple.com/it/app/ioswebble/id6761301368) · [limite Bluetooth Apple TV](https://zwiftinsider.com/apple-tv-connection-limit) · [passerelle DirCon](https://github.com/Berg0162/DirCon)

## Architecture de livraison

Recommandation : un cœur web unique en TypeScript, livré tel quel dans le navigateur (PWA) et enveloppé par Capacitor sur iOS et Android, là où le web ne suffit pas. Pas d'enveloppe ordinateur au lancement, aucun paquet TV.

### Options comparées

| Option | Couvre | Accès capteurs | Forces | Faiblesses | Verdict |
|---|---|---|---|---|---|
| PWA seule | Ordinateur, Android | Web Bluetooth (Chromium seulement) | Zéro store, mises à jour instantanées, un seul build | Pas de BLE sur iOS ; pas de présence en store | Canal web, insuffisant seul |
| Web + Capacitor (version 8, 9 annoncée fin nov. 2026) | iOS, Android | Plugin `@capacitor-community/bluetooth-le`, API calquée sur Web Bluetooth | Même code que la PWA ; plugin BLE mûr ; mises à jour à chaud du bundle web possibles | WebView système (WKWebView sur iOS) : perfs GPU légèrement inférieures au navigateur ; WebGPU dans la WebView Android à confirmer | **Retenu pour mobile** |
| Web + Tauri 2 | Ordinateur, iOS, Android | Plugin communautaire `tauri-plugin-blec` (btleplug) | Binaires légers, cœur Rust performant | Écosystème mobile et BLE plus jeune ; WebView différente par OS | Alternative ordinateur |
| Web + Electron | Ordinateur | Web Bluetooth intégré, accès USB (ANT+) et TCP (DIRCON) | Chromium identique partout, WebGPU garanti | Installeur lourd (≈ 100 Mo et plus) | Plus tard, si ANT+ ou DIRCON requis |
| Paquets TV (Tizen, webOS, Android TV, Fire TV) | TV et boîtiers | Pont téléphone | Présence dans les stores TV | Matériel faible, moteurs web figés, pas de WebGPU fiable | Écartés le 27 octobre |
| Natif tvOS | Apple TV | CoreBluetooth natif | Seule voie sur Apple TV | Second code de rendu à maintenir | Écarté : AirPlay suffit |

### Règles de conception pour le cœur web

- **Séparation stricte** : logique de jeu et simulation sans dépendance au DOM ; rendu, UI et entrées dans des couches remplaçables ; capteurs derrière l'interface SensorHub.
- **Détection de capacités, jamais de navigateur** : WebGPU, Web Bluetooth, Wake Lock, Gamepad, WebTransport testés au démarrage, avec repli documenté pour chacun.
- **Un seul build (ES2022), deux profils de rendu** choisis au démarrage : WebGPU complet, ou repli WebGL2 (niveaux de détail discrets, effets réduits).
- **Assets embarqués dans les coquilles mobiles** (lancement rapide, temps de chargement maîtrisé) ; API et temps réel restent distants.
- **Mise à jour du bundle web sans republier** (live update) sur Capacitor, dans le respect des règles des stores.

### Risque App Store (règle 4.2)

Apple rejette fréquemment les applications qui ne sont qu'un site web dans une WebView (« minimum functionality »). L'app iOS doit donc apporter un vrai apport natif : Bluetooth natif, intégration Apple Santé, notifications de séance. Le plugin BLE et HealthKit justifient à eux seuls l'enveloppe.

Sources : [Capacitor 8](https://blogs.apievangelist.com/blogs/ionic-2025-12-09-announcing-capacitor-8/) · [feuille de route Capacitor 9](https://www.plushcap.com/content/ionic/blog/ionic-the-road-to-capacitor-9) · [plugin bluetooth-le](https://github.com/capacitor-community/bluetooth-le) · [tauri-plugin-blec](https://docs.rs/crate/tauri-plugin-blec/latest) · [règle 4.2 et WebView](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper)

## Rendu graphique et moteur 3D

Recommandation révisée le 27 octobre : Three.js r186 avec `WebGPURenderer` en « WebGPU d'abord », géométrie virtuelle pour le décor statique et chaîne de niveaux de détail générée automatiquement pour les coureurs. Babylon.js 9 reste l'alternative, à départager en preuve de concept. Sans smart TV, toutes les cibles exposent WebGPU, ce qui permet de garder la géométrie dense des maquettes (environ 45 000 triangles par coureur) au lieu de la réduire à la main.

### Ce que change l'exclusion des TV

- **WebGPU devient le chemin principal** : activé par défaut dans Chrome et Edge sur ordinateur, Chrome Android 12+, Safari 26 (macOS, iOS, iPadOS) et Firefox sur Windows et Mac Apple Silicon. L'iPhone 11, plancher iOS, reçoit iOS 26.
- **WebGL2 n'est plus qu'un repli dégradé** (Firefox Android et Linux, appareils anciens, WebView sans WebGPU) : mêmes scènes, niveaux de détail discrets, effets réduits.
- **Plus de build ES2020 ni de repli WebGL1** : l'avantage de Babylon.js sur les vieilles TV (repli WebGL1) disparaît, et les fonctions qui exigent des shaders de calcul deviennent utilisables.

### Deux techniques pour ne pas réduire les triangles

- **Géométrie virtuelle pour le décor statique** (terrain, arbres, rochers, bâtiments, arches) : chaque maillage est découpé en grappes de 128 triangles rangées en hiérarchie de détail ; à chaque image, un shader de calcul choisit pour chaque grappe la version dont l'erreur reste sous le pixel et écarte ce qui est hors champ ou caché. Les modèles sont importés en pleine définition, sans niveaux de détail faits main. La bibliothèque [three-virtual-geometry](https://github.com/elad12390/three-virtual-geometry) (MIT, 2026, Three.js r180+) annonce 5,7 milliards de triangles sources affichés à 160–230 images/s en 1080p sur un MacBook Pro M4 Pro, ombres comprises. Limites : maillages statiques et WebGPU uniquement, projet très jeune (une seule étoile GitHub). Décision en preuve de concept : l'adopter, ou réimplémenter la technique en interne sur meshoptimizer.
- **Chaîne de niveaux de détail automatique pour les coureurs animés**, que la géométrie virtuelle ne gère pas : simplification meshoptimizer à partir du modèle complet (environ 45 000 triangles près de la caméra, 12 000 à mi-distance, 3 000 au loin, imposteur au-delà), animation calculée sur GPU, instanciation par équipe. Les coureurs proches gardent tout leur détail ; seuls ceux qui n'occupent que quelques dizaines de pixels sont simplifiés.

### Moteurs comparés, qualité d'image d'abord

| Moteur | Rendu web | Qualité d'image disponible | Géométrie dense | Intégration (Bluetooth, DOM, Capacitor) | Verdict |
|---|---|---|---|---|---|
| [Three.js r186](https://www.utsubo.com/blog/threejs-2026-what-changed) (sept. 2026) | WebGPU, repli WebGL2 automatique ; shaders TSL compilés en WGSL et GLSL | Éclairage en clusters (r185), soleil à ombres en cascades `SunLight` (r186), conservation d'énergie PBR retravaillée (r186), illumination indirecte par grille de sondes (r184) ou par voxels (VXGI, WebGPU seul), SSGI, GTAO, TRAA, mise à l'échelle TAAU et FSR 1 (r184) | Géométrie virtuelle en bibliothèque tierce ; BatchedMesh, instanciation, shaders de calcul | TypeScript, DOM natif, aucune friction avec Capacitor ni Web Bluetooth ; licence MIT | **Recommandé** |
| [Babylon.js 9](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0) (mars 2026) | WebGPU et WebGL2 | Éclairage en clusters sur les deux API, éclairage volumétrique, lumières surfaciques texturées, Frame Graph (jusqu'à 40 % de mémoire GPU en moins selon l'équipe), reciblage d'animation, inspecteur | Pas de géométrie virtuelle ; niveaux de détail et instanciation classiques | TypeScript, DOM ; Apache 2.0 ; plus lourd que Three.js | **Alternative n° 1**, départagée en preuve de concept |
| [PlayCanvas 2.23](https://developer.playcanvas.com/user-manual/graphics/) | WebGL2 d'abord ; WebGPU encore « bêta » dans sa documentation | Chaîne CameraFrame (TAA, SSAO, bloom, profondeur de champ, brouillard volumétrique), éclairage en clusters, lumières surfaciques ; référence du Gaussian splatting | Classique | JS/TS ; éditeur cloud en offre payante | Non retenu : WebGPU pas encore mûr |
| [Unity 6.6](https://app.cinevva.com/news/2026-09-01-unity-6-6-webgpu-production) (sept. 2026), export web | WebGPU pris en charge mais désactivé par défaut ; WebGL2 par défaut | GPU Resident Drawer, occlusion sur GPU, mise à l'échelle STP, sondes adaptatives (APV), particules VFX Graph, skinning en calcul | Le plus outillé (dessin et occlusion pilotés par GPU) | C# compilé en WASM, gros bundles, Bluetooth via pont JavaScript, filtrage d'appareils requis, licence payante au-delà d'un seuil de revenus | Écarté pour le web ; à reconsidérer si la base de code web unique est abandonnée |
| [Godot 4.7](https://app.cinevva.com/fr/news/2026-06-19-godot-4-7-released) (juin 2026) | WebGL2 seulement (renderer Compatibility) | Forward+ (SSAO, SSR, SDFGI, brouillard volumétrique) indisponible sur le web | — | GDScript, WASM | Écarté |
| Bevy (Rust, wgpu) | WebGPU sur le web | Bon PBR en natif | Géométrie virtuelle réservée au natif : elle exigeait en 2025 des atomiques 64 bits absents de WebGPU ([auteur](https://news.ycombinator.com/item?id=42975705)) | Rust et WASM, écosystème jeune | Écarté |
| [Unreal Engine 5.8](https://en.wikipedia.org/wiki/Unreal_Engine_5) | Aucun export web ; Pixel Streaming seulement | Nanite, Lumen | Natif | Vidéo streamée : un GPU cloud par joueur | Écarté (coût d'hébergement) |

### Chaîne de rendu proposée (Three.js)

1. **Matériaux** PBR en TSL (`MeshStandardNodeMaterial`) aux couleurs des palettes, formes arrondies des maquettes conservées.
2. **Éclairage** : soleil `SunLight` à ombres en cascades (2 à 4 selon le profil), éclairage d'environnement du ciel, grille de sondes précalculée par monde pour la lumière indirecte.
3. **Passe de scène** en rendu multicible (couleur, normales, vitesse), puis GTAO, bloom et anticrénelage temporel TRAA ; SSGI ou VXGI réservés au profil haut, reflets SSR sur le lac de la Rive du lac.
4. **Résolution interne** réduite et mise à l'échelle TAAU sur mobile, pour garder la netteté sans payer le plein écran.
5. **Interface** (menus, HUD) en DOM et CSS superposés au canevas ; noms au-dessus des avatars en texte SDF compatible WebGPU (bibliothèque à valider).
6. **Contenus** : décor généré en code puis converti en géométrie virtuelle au chargement (cache navigateur) ; avatars et vélos en glTF 2.0 depuis Blender, compression meshopt et textures KTX2.

Rendu hors thread principal (OffscreenCanvas dans un Worker) à évaluer en preuve de concept. Three.js publie une version toutes les 8 à 11 semaines avec des ruptures d'API : version épinglée, migration par paliers.

Sources : [Three.js r182–r186](https://www.utsubo.com/blog/threejs-2026-what-changed) · [three-virtual-geometry](https://github.com/elad12390/three-virtual-geometry) · [SSGI](https://threejs.org/docs/pages/SSGINode.html) · [VXGI](https://threejs.org/docs/pages/VXGINode.html) · [Babylon.js 9.0](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0) · [PlayCanvas graphics](https://developer.playcanvas.com/user-manual/graphics/) · [Unity 6.6 WebGPU](https://app.cinevva.com/news/2026-09-01-unity-6-6-webgpu-production) · [Godot 4.7](https://app.cinevva.com/fr/news/2026-06-19-godot-4-7-released) · [Bevy et WebGPU](https://news.ycombinator.com/item?id=42975705) · [comparatif des moteurs web 2026](https://app.cinevva.com/guides/web-game-engines-comparison.html)

## Direction artistique et budget de performance

Le style retenu le 26 octobre (3D stylisée à formes arrondies, ombres temps réel, coureurs détaillés) remplace le low poly à palette : la qualité d'image passe avant la légèreté. Les budgets se tiennent par la géométrie virtuelle, les niveaux de détail générés et la mise à l'échelle temporelle, pas par la réduction des modèles. Les chiffres ci-dessous sont des cibles proposées, à valider en preuve de concept sur les appareils planchers.

### Techniques de rendu retenues

| Technique | Ce qu'elle apporte | Contrepartie |
|---|---|---|
| Formes arrondies, ombrage lisse, matériaux PBR aux couleurs de palette | Rendu proche des simulateurs du marché, fidèle aux maquettes | Plus de triangles qu'en low poly |
| Géométrie virtuelle du décor statique | Détail complet près de la caméra, environ un triangle par pixel au loin, sans niveaux de détail faits main | WebGPU seulement ; maillages statiques seulement |
| Niveaux de détail des coureurs générés par meshoptimizer, imposteurs au loin | 45 000 triangles près de la caméra, quelques milliers au loin | Étape de génération au build |
| Ombres temps réel en cascades (`SunLight`) | Ombres portées des coureurs, des vélos et du relief | Coût par cascade : 2 sur mobile, jusqu'à 4 sur ordinateur |
| Lumière indirecte par grille de sondes précalculée, plus GTAO | Ombrage doux et contacts crédibles | Précalcul par monde |
| Anticrénelage temporel TRAA et mise à l'échelle TAAU | Arêtes nettes sur tubes fins et rayons ; résolution interne réduite sur mobile | Traînées à régler sur les objets rapides |
| Instanciation et animation calculées sur GPU | Peloton de 50 coureurs en quelques appels de dessin | Variations limitées par instance |
| Brouillard de distance et ciel en dégradé | Profondeur, masque le chargement des tuiles | Horizon atténué |
| Résolution dynamique | Stabilise la fréquence d'images | Image plus douce en pic de charge |
| Profil de repli WebGL2 | Même monde sur les navigateurs sans WebGPU | Niveaux de détail discrets, pas de géométrie virtuelle, FXAA |

### Budgets proposés par profil matériel

| Profil | Appareil plancher | Résolution interne | Images/s cible | Triangles dessinés par image | Coureurs en pleine définition | Effets |
|---|---|---|---|---|---|---|
| Mobile milieu de gamme | iPhone 11 (iOS 26), Android 2021 (Adreno 6xx, Mali-G57) | 60–75 % de la définition native, TAAU | 30, 60 visé | 1,5 million | 8 | 2 cascades d'ombres, GTAO en demi-résolution, TRAA |
| Ordinateur à GPU intégré | Intel Iris Xe, AMD Radeon 680M, Apple M1 | 1080p, TAAU depuis 80 % | 60 | 4 millions | 20 | 3 cascades, GTAO, bloom, TRAA |
| Ordinateur à GPU dédié ou Apple M3+ | — | 1440p à 4K | 60 et plus | 10 millions | 50 | 4 cascades, SSGI ou VXGI, SSR, brouillard volumétrique |
| Repli WebGL2 | Tout appareil sans WebGPU | 720p à 1080p | 30 | 1 million | 5 | 2 cascades, FXAA |

### Exigences de performance associées

- **Profils de qualité automatiques** : mini-test GPU au premier lancement (scène témoin de quelques secondes) et identification du GPU, avec réglage manuel possible.
- **Gestion thermique sur mobile** : une sortie dure 1 à 2 h ; si le temps d'image dérive, le profil baisse d'un cran (résolution interne, cascades, effets) sans couper la sortie.
- **Boucle de rendu sans allocation** : aucun objet créé par image dans les chemins critiques ; le budget est de 33 ms par image à 30 images/s, 16,7 ms à 60.
- **Ressources GPU libérées explicitement** : textures, tampons et pipelines ne sont pas récupérés par le ramasse-miettes.
- **Pause complète en arrière-plan** : arrêt de la boucle et libération des ressources lourdes à l'événement `visibilitychange`.
- **Monde découpé en tuiles le long du parcours** : chargement anticipé selon la vitesse, déchargement derrière le coureur ; hiérarchies de géométrie virtuelle mises en cache dans le navigateur.
- **Assets compressés** : glTF et meshopt pour la géométrie, KTX2/Basis pour les textures (transcodées vers le format GPU natif de chaque appareil).
- **Budget de téléchargement initial** : la première sortie démarre après moins de 15 Mo téléchargés sur le web, le reste en flux.
- **Indicateurs mesurés en continu** : temps d'image (p50, p95), triangles dessinés, appels de dessin, mémoire GPU estimée, profil actif, remontés dans la télémétrie.

Sources : [three-virtual-geometry](https://github.com/elad12390/three-virtual-geometry) · [Three.js r182–r186](https://www.utsubo.com/blog/threejs-2026-what-changed)

## Simulation et logique d'entraînement

La simulation doit être un module TypeScript déterministe, à pas de temps fixe, sans dépendance au rendu : le même code tourne dans le client et sur le serveur (validation des performances). C'est la partie la plus « métier » du produit et elle ne dépend d'aucun moteur 3D.

### Modèle physique vélo

À chaque pas, la vitesse est obtenue en intégrant l'équilibre entre la puissance mesurée et les résistances (roulement, gravité, air, inertie) :

```
\eta P = v\left(m g C_{rr}\cos\theta + m g \sin\theta + \tfrac{1}{2}\rho\, C_dA\,(v + v_w)^2\right) + m\, v\, \frac{dv}{dt}
```

- Paramètres : P puissance, η rendement de transmission, m masse cycliste + vélo, θ pente, Crr coefficient de roulement, ρ densité de l'air, CdA traînée, v_w vent.
- Valeurs indicatives à calibrer : η ≈ 0,97 ; Crr ≈ 0,004 sur route ; ρ ≈ 1,2 kg/m³ ; CdA ≈ 0,3 m² mains en haut.
- **Aspiration (drafting)** : réduction paramétrable du CdA selon la distance et l'alignement avec le coureur de devant.
- **Choix de vélo et de roues** comme modificateurs de masse et de CdA (levier de progression du jeu).
- **Pas de moteur physique générique** : déplacement contraint sur la spline du parcours, collisions de peloton gérées par règles simples.

### Modes de pilotage du home trainer

- **SIM** : envoi de la pente (et du vent) via FTMS, multipliée par un facteur de difficulté réglable, à la manière du « trainer difficulty » de Zwift. Plafonner la pente envoyée aux capacités du home trainer.
- **ERG** : puissance cible de la séance, avec rampes progressives et gestion de la « spirale » quand la cadence s'effondre (relâchement temporaire de la cible).
- **Puissance virtuelle** : pour un home trainer non connecté, estimation de la puissance à partir de la vitesse (capteur CSC) et d'une courbe par modèle de home trainer.
- **Changement de vitesses virtuel** (optionnel, seconde vague) : rapport de transmission simulé, résistance ajustée en conséquence.

### Course à pied (seconde vague)

- Vitesse lue sur le tapis (FTMS Treadmill Data) ou sur le capteur de foulée (RSC), avec étalonnage du capteur.
- Pilotage de l'inclinaison des tapis FTMS optionnel, désactivé par défaut et soumis à confirmation (sécurité).
- Avatar animé par la cadence et la vitesse ; pas de résistance à simuler.

### Séances structurées et formats

| Format | Usage | Sens |
|---|---|---|
| `.zwo` (XML Zwift) | Séances en % de FTP : paliers, échauffements, rampes, cadence cible, messages | Import et export |
| `.erg` / `.mrc` | Séances texte en watts absolus ou en % de FTP | Import et export |
| FIT Workout | Séances échangées avec Garmin et autres plateformes | Import |
| FIT Activity | Enregistrement de la sortie (puissance, cadence, FC, vitesse, altitude) | Export, via le SDK FIT JavaScript officiel de Garmin, qui encode désormais |
| TCX / GPX | Compatibilité avec des services plus anciens | Export optionnel |

### Indicateurs d'entraînement

- FTP, zones de puissance et de fréquence cardiaque, puissance normalisée, charge d'entraînement, énergie dépensée (kJ).
- Éviter les marques déposées (par exemple « TSS ») dans l'interface au profit d'indicateurs équivalents nommés différemment.
- Courbe de puissance personnelle (meilleures valeurs par durée) et suivi de forme.

### Intégrité des données et équité

- Étiquetage de la source de puissance (home trainer, capteur de puissance, puissance virtuelle).
- Contrôles de plausibilité côté serveur : pics de puissance, rapport puissance/fréquence cardiaque, sauts de vitesse.
- Catégories de course par W/kg ; double enregistrement possible pour les compétitions.

Sources : [SDK FIT JavaScript de Garmin](https://github.com/garmin/fit-javascript-sdk) · [encodeur FIT JavaScript](https://forums.garmin.com/developer/fit-sdk/f/discussion/361529/ability-to-encode-an-activity-using-javascript-sdk/1884115) · [référence du format .zwo](https://www.github.com/h4l/zwift-workout-file-reference/blob/master/descriptions.yaml) · [formats zwo/mrc/erg/fit (intervals.icu)](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090)

## Multijoueur temps réel

Recommandation : WebSocket binaire comme transport universel, serveur de salles en TypeScript (Colyseus ou maison sur uWebSockets.js), et un modèle « client fait foi pour son propre mouvement, serveur valide et arbitre les courses ». Le jeu est peu nerveux : la contrainte est le nombre de coureurs visibles et la bande passante mobile, pas la latence. Cible initiale : 50 participants par monde ; la montée en charge passe par l'ajout de salles et d'instances, sans changer le protocole.

### Transports

| Transport | Disponibilité | Usage proposé |
|---|---|---|
| WebSocket | Partout | **Socle** : positions, chat, événements |
| WebTransport (HTTP/3, datagrammes non fiables) | Baseline depuis mars 2026 (Safari 26.4) | Optionnel pour les clients modernes, derrière détection de capacité |
| WebRTC (canaux de données) | Navigateurs | Non retenu : complexité NAT/STUN/TURN pour un gain faible ici |

### Modèle de synchronisation

- **Autorité** : chaque client calcule sa propre position à partir de sa puissance (latence perçue nulle) ; le serveur recalcule et rejette les incohérences. En course, le serveur fait foi pour classement, chronos et aspiration.
- **Représentation compacte** : position = distance le long du parcours + décalage latéral, plus vitesse, puissance, cadence et fréquence cardiaque quantifiées. Environ 16 octets par coureur et par mise à jour (estimation).
- **Gestion d'intérêt** : un client ne reçoit que les coureurs proches sur le parcours, à fréquence décroissante avec la distance (par exemple 10 Hz à proximité, 1–2 Hz au loin).
- **Interpolation côté client** : rendu 100 à 200 ms dans le passé pour lisser les autres coureurs ; extrapolation courte en cas de perte.
- **Sérialisation binaire** : schéma versionné (Colyseus Schema, FlatBuffers ou protobuf), deltas plutôt qu'états complets.
- **Population** : coureurs « bots » meneurs d'allure et fantômes rejoués pour animer le monde quand peu d'utilisateurs sont en ligne.

### Téléphone compagnon

- Le téléphone (PWA ou app Capacitor) sert de télécommande tactile et d'affichage secondaire des données, dans la même session temps réel.
- Pour Safari et Firefox sur ordinateur, privés de Web Bluetooth, il lit aussi les capteurs et publie les mesures dans la salle du joueur, rôle « source de capteurs ».
- Appairage par QR code affiché sur l'écran principal ; le relais passe par le serveur.

### Options serveur

| Option | Nature | Forces | Faiblesses | Verdict |
|---|---|---|---|---|
| [Colyseus 0.17](https://www.github.com/colyseus/colyseus) | Framework de salles autoritaires, Node.js, MIT | TypeScript partagé avec le client, synchronisation d'état par deltas, matchmaking, transports WebSocket, uWebSockets.js et WebTransport | Mono-thread par salle, montée en charge horizontale à concevoir | **Recommandé pour démarrer** |
| Serveur maison (Node/Bun + uWebSockets.js) | Sur mesure | Contrôle total du protocole et des performances | Tout à construire (salles, reconnexion, monitoring) | Si Colyseus devient limitant |
| [Nakama](https://heroiclabs.com/blog/unity-multiplayer-backend/) | Serveur de jeu social, Go, Apache 2.0 | Comptes, classements, groupes, chat, matchmaking, matchs autoritaires en TypeScript/Lua/Go | Base Postgres ou CockroachDB ; version libre décrite comme mono-nœud ; plus lourd à opérer | Alternative « backend complet » |
| [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing) | Objets à état en périphérie, WebSocket intégré | Un objet par salle ou événement, mise en veille des sockets, facturation à l'usage | Un objet = un fil d'exécution ; boucle de simulation à forte charge peu adaptée | Pour groupes, lobbies, chat et pont capteurs |
| Orchestrateurs de serveurs de jeu (Edgegap, GameFabric, Gameye, GameLift) | Hébergement conteneurs | Mise à l'échelle mondiale | Coût, dépendance fournisseur | Plus tard, à grande échelle |

**Risque fournisseur** : Hathora a fermé son hébergement de serveurs de jeu le 5 mai 2026 après un pivot vers l'IA, forçant ses clients à migrer. Exiger des serveurs conteneurisés et portables, sans SDK propriétaire dans le binaire.

Sources : [WebTransport Baseline](https://web-platform-dx.github.io/web-features-explorer/features/webtransport) · [transports Colyseus](https://docs.colyseus.io/tools) · [Nakama](https://github.com/lavren1974/nakama) · [Nakama libre mono-nœud (témoignage)](https://discussions.unity.com/t/nakama-an-open-source-distributed-server-for-realtime-games/657543) · [fermeture de Hathora](https://docs.edgegap.com/docs/tools-and-integrations/switch-from-hathora)

## Backend, données et intégrations

Recommandation : TypeScript de bout en bout (client, temps réel, API) pour partager simulation, schémas de messages et validation ; PostgreSQL pour les données relationnelles, stockage objet pour les fichiers FIT et assets, Redis pour la présence et les classements. Les intégrations tierces sont toutes soumises à approbation : à lancer tôt, elles sont sur le chemin critique.

### Briques backend proposées

| Brique | Choix proposé | Rôle |
|---|---|---|
| API applicative | Node.js ou Bun, REST + OpenAPI (ou tRPC en interne) | Comptes, profils, séances, parcours, événements |
| Temps réel | Serveur de salles (section précédente) | Positions, courses, pont capteurs |
| Base relationnelle | PostgreSQL | Utilisateurs, activités (métadonnées), événements, inventaire |
| Fichiers | Stockage objet compatible S3 + CDN | Fichiers FIT bruts, assets 3D, paquets de mondes |
| Cache, présence, classements | Redis (ensembles triés) | Qui est en ligne, classements de segments |
| Authentification | OIDC (e-mail, Google, Apple) | Connexion unique sur le web et dans les coquilles ; appairage du téléphone compagnon par QR code |
| Paiement | Aucun au lancement (application gratuite) ; module isolé pour ajouter plus tard Stripe et les achats intégrés | Monétisation future éventuelle, sans commission de store aujourd'hui |
| Observabilité | OpenTelemetry + outil de suivi d'erreurs client | Erreurs, temps d'image, déconnexions capteurs |

### Intégrations tierces

| Service | Usage visé | Accès | Contraintes à intégrer au cahier des charges |
|---|---|---|---|
| [Strava](https://tryterra.co/blog/strava-api-changes-2026) | Envoi automatique des sorties | OAuth ; programme refondu le 1er juin 2026 ; au-delà de 10 athlètes, capacité soumise à revue sans délai garanti | Données affichables uniquement à leur propriétaire ; usage en IA interdit ; nouvelle URL d'API au 4 janvier 2027 |
| [Garmin Connect](https://developer.garmin.com/gc-developer-program/training-api) | Pousser les séances vers montres et compteurs (Training API), récupérer des activités (Activity API) | Programme gratuit pour entreprises approuvées | OAuth 1.0a retiré fin 2026, prévoir OAuth 2.0 + PKCE |
| [TrainingPeaks](https://help.trainingpeaks.com/hc/en-us/articles/234441128-TrainingPeaks-API) | Importer les séances planifiées par le coach, déposer les sorties | Partenaires approuvés, réponse en 7 à 10 jours | Plusieurs fonctions exigent un compte athlète premium |
| [intervals.icu](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090) | Séances planifiées (zwo, fit, mrc, erg) et dépôt d'activités | OAuth | Public avancé, intégration simple |
| [Wahoo Cloud API](https://github.com/api-evangelist/wahoo) | Synchronisation des séances et fichiers FIT | OAuth 2.0, approbation de l'app | Limite de 10 jetons actifs par utilisateur depuis le 1er janvier 2026 |
| Apple Santé / Health Connect | Écrire les séances et la fréquence cardiaque | Via plugin natif (Capacitor annonce un plugin Santé officiel avec la v9) | Justifie l'app native iOS (règle 4.2) |

### Données personnelles et conformité

- La fréquence cardiaque et le poids sont des données de santé : consentement explicite, finalités déclarées, suppression de compte en libre-service.
- Cadre canadien : LPRPDE, plus la Loi 25 si des utilisateurs sont au Québec ; RGPD dès la conception, l'Europe étant envisagée. Choisir un hébergeur proposant une région européenne.
- Profils publics et classements opt-in ; position géographique réelle jamais exposée.
- Sur iOS, une app qui propose une connexion via Google ou un autre tiers doit aussi offrir une option équivalente respectueuse de la vie privée, en pratique « Se connecter avec Apple » (règle à revérifier au moment de la soumission).

Sources : [Strava, changements 2026](https://tryterra.co/blog/strava-api-changes-2026) · [Garmin Training API](https://developer.garmin.com/gc-developer-program/training-api) · [Garmin Activity API](https://developer.garmin.com/gc-developer-program/activity-api/) · [Garmin OAuth 2.0 + PKCE](https://pypi.org/project/django-garmin/) · [TrainingPeaks API](https://help.trainingpeaks.com/hc/en-us/articles/234441128-TrainingPeaks-API) · [TrainingPeaks premium](https://docs.tryterra.co/help-center/help-topics/data-api-sdk/provider-coverage-and-per-provider-data-availability/trainingpeaks-premium-account-requirements) · [Capacitor 9 et plugin Santé](https://www.plushcap.com/content/ionic/blog/ionic-the-road-to-capacitor-9)

## Interface multi-écrans

Une seule interface DOM, pensée pour le tactile, la souris et la manette, et lisible à 2–3 m quand l'image est recopiée sur un téléviseur. Pendant l'effort, l'utilisateur a les mains sur le guidon : l'interface de sortie doit se lire de loin et se piloter avec très peu d'actions.

### Entrées à prendre en charge

| Entrée | Plateformes | Exigence |
|---|---|---|
| Tactile | Mobile, tablette | Cibles d'au moins 44 px, gestes simples, aucune action critique au survol |
| Souris et clavier | Ordinateur | Raccourcis pour les actions de sortie (changer de vue, prendre un virage, lancer un bonus) |
| Manette (Gamepad API) | Ordinateur, Android, iPad | Mappage par défaut des boutons, réglable |
| Télécommande au guidon (BLE) | Toutes via SensorHub | Seconde vague : direction, changement de vitesses virtuel |
| Téléphone compagnon | Ordinateur, tablette | Télécommande tactile + affichage des données, via la même session temps réel |

### Bibliothèques et API web

- **Navigation au clavier et à la manette** : focus suivant l'ordre du DOM, quelques raccourcis ; plus besoin de bibliothèque de navigation spatiale pour télécommande.
- **Empêcher la mise en veille** : Screen Wake Lock API (Chromium 84+, Firefox 126+, iOS 18.4+ en pleine prise en charge) ; plugin natif en repli dans l'enveloppe Capacitor.
- **Plein écran** : Fullscreen API sur ordinateur et Android ; sur iPhone, mode autonome (PWA ou app native) car le plein écran d'élément n'y est pas disponible hors vidéo.
- **Orientation** : paysage imposé sur téléphone via l'enveloppe native ; message d'invite sur le web.
- **Audio** : Web Audio, démarré après un geste utilisateur (règles d'autoplay) ; volume musique, effets et annonces séparés.

### Règles de lisibilité à distance

- Texte de 16 px minimum sur mobile et de 24 px en 1080p ; marge de sécurité de 5 % sur les bords, utile quand l'image est recopiée sur un téléviseur.
- HUD de sortie limité à l'essentiel : puissance (moyenne 3 s), cible ERG, fréquence cardiaque, cadence, pente, temps et distance, position dans le groupe.
- Contrastes AA (WCAG 2.2) ; palettes compatibles daltonisme pour les zones de puissance.
- Option « mouvement réduit » : caméra stable, pas de balancement, champ de vision réglable, contre le mal des transports.
- Langues française et anglaise au lancement ; unités métriques et impériales.

### Hors ligne et reprise

- Service worker pour l'application et les assets de base ; IndexedDB pour les sorties en attente d'envoi.
- Pas de mode hors ligne : une connexion est requise pour lancer une sortie.
- Reprise automatique de la session après une coupure courte (réseau ou Bluetooth), sans perdre l'enregistrement.

Sources : [Screen Wake Lock (support)](https://caniuse.com/mdn-api_wakelock_request) · [Wake Lock Baselin](https://web-platform-dx.github.io/web-features-explorer/features/screen-wake-lock/)[e](https://web-platform-dx.github.io/web-features-explorer/features/screen-wake-lock/)

## Outillage, tests et distribution

Un monorepo TypeScript unique produit tous les livrables (web, coquilles mobiles, serveurs) à partir des mêmes paquets, avec des budgets de taille et de performance vérifiés en intégration continue. Un petit parc d'appareils physiques reste indispensable : ni émulateurs ni fermes de test ne reproduisent le Bluetooth ni le comportement thermique des GPU mobiles.

### Organisation du code

- **Monorepo** (pnpm workspaces + Turborepo ou Nx) : `sim-core`, `protocol`, `sensors`, `renderer`, `ui`, `client-web`, `shell-capacitor`, `server-realtime`, `server-api`.
- **Build** : Vite ; une cible de transpilation (ES2022) ; budgets de taille de bundle bloquants en CI ; génération hors ligne des niveaux de détail des coureurs et des hiérarchies de géométrie virtuelle.
- **Contrats partagés** : schémas de messages et types générés une fois, consommés par client et serveurs.

### Stratégie de test

| Niveau | Outil proposé | Ce qui est vérifié |
|---|---|---|
| Unitaire | Vitest | Physique, décodage des trames FTMS/CPS/HRM à partir de traces Bluetooth enregistrées, parsers .zwo/.erg/.mrc, encodage FIT |
| Propriétés | fast-check | Stabilité numérique de la simulation, absence de dérive entre client et serveur |
| Capteurs | Périphérique BLE virtuel (FTMS simulé) + matériel réel | Appairage, reconnexion, commandes ERG/SIM, perte de signal |
| Bout en bout | Playwright (Chromium, WebKit, Firefox) | Parcours d'inscription, lancement de sortie avec simulateur de capteurs, HUD |
| Rendu | Captures de référence + mesure du temps d'image sur appareils planchers | Régressions visuelles et de performance |
| Charge | Outils de test de charge WebSocket (k6, outil Colyseus) | Coureurs par salle, bande passante, latence serveur |

### Parc d'appareils de test

- Mobiles planchers : iPhone 11 sous iOS 26, un Android 2021 à GPU Adreno 6xx et un à GPU Mali-G57.
- Ordinateurs : portable Intel Iris Xe, Mac M1, PC à GPU dédié, et un ancien portable Intel UHD 620 pour le repli WebGL2.
- Recopie : un Chromecast avec Google TV et une Apple TV, pour vérifier lisibilité et latence d'image sur grand écran.

### Observabilité en production

- Suivi d'erreurs JavaScript et natif, y compris perte de contexte WebGL.
- Télémétrie produit : temps d'image p50/p95, profil de qualité choisi, déconnexions capteurs, latence temps réel.
- Envoi par `navigator.sendBeacon` pour ne pas perdre les dernières mesures à la fermeture.

### Canaux de distribution

| Canal | Livrable | Points d'attention |
|---|---|---|
| Web | PWA sur domaine HTTPS | Web Bluetooth seulement sur Chromium ; WebGPU exige un contexte sécurisé ; mises à jour immédiates |
| App Store (iPhone, iPad) | Coquille Capacitor | Règle 4.2 ; achats intégrés ; revue à chaque version native |
| Google Play (téléphone, tablette) | Coquille Capacitor | Optionnel au lancement, la PWA couvrant Android |

Sources : [transports et outils Colyseus](https://docs.colyseus.io/tools) · [Unity 6.6 et WebGPU en contexte sécurisé](https://app.cinevva.com/news/2026-09-01-unity-6-6-webgpu-production)

## Risques, inconnues et preuves de concept

Trois inconnues peuvent invalider l'architecture et doivent être levées avant de figer le cahier des charges : la qualité de rendu tenable sur mobile avec une géométrie dense, la connexion capteurs hors Chromium, et l'acceptation de l'app iOS. Les demandes d'accès aux API partenaires sont à lancer immédiatement, leurs délais ne dépendant pas de l'équipe.

### Registre des risques

| Risque | Conséquence | Parade | Preuve de concept |
|---|---|---|---|
| GPU mobile insuffisant pour la géométrie dense et les ombres | Moins de 30 images/s ; chauffe et baisse de fréquence en sortie longue | Profils automatiques, TAAU, niveaux de détail générés, baisse de profil en cas de dérive thermique | PoC 2 |
| Bibliothèque de géométrie virtuelle trop jeune (un seul mainteneur) | Bogues, abandon du projet | Version épinglée et forkée, ou réimplémentation sur meshoptimizer ; repli sur niveaux de détail classiques | PoC 2 |
| WebGPU instable sur certains pilotes, ou absent de la WebView Android | Plantages, écran noir | Détection de capacités, liste d'appareils exclus, repli WebGL2 automatique | PoC 2 |
| Ruptures d'API Three.js (une version toutes les 8 à 11 semaines) | Coût de maintenance | Version épinglée, migration par paliers, captures de référence en CI | — |
| Implémentations FTMS hétérogènes selon marques | Commandes ERG/SIM ignorées ou instables | Couche « particularités » par modèle, matrice de compatibilité publiée | PoC 1 |
| Fiabilité du relais par téléphone compagnon | Coupures pour les utilisateurs de Safari ou Firefox sur ordinateur | Reconnexion, tampon ; Chrome ou Edge recommandés | PoC 1 |
| Rejet App Store (règle 4.2) | Pas de présence iOS | BLE natif, HealthKit, notifications | PoC 4 |
| Accès Strava, Garmin, TrainingPeaks retardé ou restreint | Fonctions de synchronisation absentes au lancement | Export FIT manuel, intervals.icu, demandes déposées tôt | Action 5 |
| Recopie sur téléviseur peu lisible ou décalée | Expérience grand écran dégradée | HUD lisible à distance, HDMI recommandé | Tests sur le parc |
| Fermeture d'un fournisseur d'infrastructure | Migration forcée | Serveurs conteneurisés, pas de SDK propriétaire | — |
| Monde vide au lancement | Expérience sociale décevante | Bots meneurs d'allure, fantômes, événements programmés | — |
| Propriété intellectuelle et marques | Litige, retrait de store | Direction artistique originale, pas de reprise de noms ni de marques déposées | Revue juridique |
| Données de santé | Non-conformité LPRPDE / Loi 25 / RGPD | Consentement, minimisation, hébergement adapté | Revue juridique |

### Preuves de concept recommandées (2 semaines chacune, dans cet ordre)

1. **Capteurs** : Web Bluetooth (Chrome ordinateur et Android) et plugin BLE natif (iOS) sur trois home trainers de marques différentes, une ceinture cardio, un capteur de foulée et un tapis FTMS ; relais du téléphone compagnon vers Safari sur ordinateur. Critères : ERG et SIM fonctionnels, reconnexion en moins de 5 s.
2. **Rendu haute densité** : même scène (parcours, 50 coureurs d'environ 45 000 triangles, décor en géométrie virtuelle, ombres en cascades, TRAA) en Three.js r186 et en Babylon.js 9, sur iPhone 11, Android Adreno 6xx et Mali, portable Iris Xe et Mac M1, dans le navigateur et dans la coquille Capacitor. Critères : 30 images/s stables pendant 60 min sur mobile et 60 sur ordinateur, température et mémoire stables, WebGPU confirmé dans WKWebView et la WebView Android. Sortie : choix du moteur, et de la géométrie virtuelle en bibliothèque ou en interne.
3. **Multijoueur** : 200 coureurs simulés dans une salle avec gestion d'intérêt. Critères : bande passante par client mobile, coût serveur par coureur.
4. **Coquille iOS** : build TestFlight avec BLE natif et HealthKit, soumise en revue pour lever le risque 4.2 tôt.
5. **Action immédiate** : dépôt des demandes d'accès Strava, Garmin Connect Developer Program, TrainingPeaks et Wahoo.

### Questions ouvertes

- Toutes les questions sont tranchées : voir les décisions des 26 et 27 octobre 2026 dans la section Contexte (dont le plancher ordinateur, relevé à Intel Iris Xe et Apple M1).
- Les seuils chiffrés (budgets de rendu, bande passante) restent à confirmer par les preuves de concept.

## Exigences proposées

Ces exigences traduisent l'évaluation en lignes vérifiables, prêtes à reprendre dans le cahier des charges ; les priorités suivent la méthode MoSCoW et se modifient directement dans la colonne Priorité. Les seuils chiffrés sont des propositions à confirmer par les preuves de concept.

### Exigences fonctionnelles

| ID | Exigence | Priorité | Vérification |
|---|---|---|---|
| EF-01 | Appairer et utiliser des capteurs Bluetooth FTMS, puissance, cardio, vitesse/cadence et foulée | Doit | Tests sur la matrice de compatibilité matérielle |
| EF-02 | Piloter le home trainer en modes SIM (pente) et ERG (puissance cible) via FTMS | Doit | PoC 1, tests sur trois marques |
| EF-03 | Calculer la vitesse à partir de la puissance selon le modèle physique documenté, aspiration comprise | Doit | Tests unitaires et de propriétés |
| EF-04 | Lire vitesse et cadence de course depuis un tapis FTMS ou un capteur de foulée (seconde vague) | Pourrait | PoC 1 |
| EF-05 | Importer et exécuter des séances .zwo, .erg et .mrc | Doit | Jeu de fichiers de référence |
| EF-06 | Exporter chaque activité au format FIT | Doit | Validation par le SDK FIT Garmin |
| EF-07 | Synchroniser les activités avec Strava, Garmin Connect, TrainingPeaks et intervals.icu | Devrait | Tests d'intégration après approbation partenaire |
| EF-08 | Afficher les autres coureurs en temps réel dans le monde (50 par monde au lancement, extensible) | Doit | PoC 3 |
| EF-09 | Organiser sorties de groupe et courses avec classement arbitré par le serveur | Devrait | Tests de charge et de bout en bout |
| EF-10 | Utiliser le téléphone comme télécommande et, pour les navigateurs sans Web Bluetooth, comme relais capteurs | Devrait | PoC 1 |
| EF-11 | Afficher la sortie sur grand écran par recopie (AirPlay, Cast) ou HDMI, avec une interface lisible à 2–3 m | Devrait | Tests sur le parc d'appareils |
| EF-12 | Peupler le monde avec des bots meneurs d'allure et des fantômes | Devrait | Revue fonctionnelle |
| EF-13 | Conserver l'enregistrement pendant une coupure réseau courte et le synchroniser au retour (pas de mode hors ligne complet) | Doit | Test réseau coupé |
| EF-14 | Mode 2D de repli pour les appareils sous le plancher (retiré le 27 octobre avec les TV) | N'aura pas | — |
| EF-15 | Estimer une puissance virtuelle pour les home trainers non connectés | Pourrait | Comparaison avec capteur de puissance |
| EF-16 | Prendre en charge le changement de vitesses virtuel et les manettes au guidon | Pourrait | Tests matériels |

### Exigences non fonctionnelles

| ID | Exigence | Priorité | Vérification |
|---|---|---|---|
| ENF-01 | 30 images/s sur les mobiles planchers (iPhone 11, Android 2021) avec 50 coureurs détaillés, en WebGPU | Doit | Temps d'image p95 ≤ 33 ms sur 60 min |
| ENF-02 | 60 images/s sur ordinateur à GPU intégré récent en 1080p | Devrait | Temps d'image p95 ≤ 16,7 ms |
| ENF-03 | Rendu WebGPU par défaut, repli WebGL2 automatique sur la même scène | Doit | Tests forcés en WebGL2 |
| ENF-04 | Aucune réduction manuelle des modèles : coureur complet (environ 45 000 triangles) affiché près de la caméra sur tous les profils WebGPU | Doit | Compteur de triangles et revue visuelle |
| ENF-05 | Première sortie lancée après moins de 15 Mo téléchargés sur le web | Devrait | Mesure en CI |
| ENF-06 | Reconnexion automatique d'un capteur en moins de 5 s, sans perte d'enregistrement | Doit | PoC 1, test de coupure |
| ENF-07 | Mémoire et température stables sur une sortie de 2 h | Doit | Profilage sur mobile et ordinateur |
| ENF-08 | Bande passante temps réel par client mobile plafonnée (seuil à fixer) | Doit | PoC 3 |
| ENF-09 | Simulation déterministe à pas fixe, identique côté client et serveur | Doit | Tests de non-dérive |
| ENF-10 | Détection de capacités systématique, aucune détection de navigateur | Doit | Revue de code |
| ENF-11 | Interface entièrement pilotable au tactile, à la souris, au clavier et à la manette | Doit | Tests manuels par plateforme |
| ENF-12 | Accessibilité WCAG 2.2 AA des menus et option « mouvement réduit » | Devrait | Audit d'accessibilité |
| ENF-13 | Français et anglais ; unités métriques et impériales | Doit | Revue de traduction |
| ENF-14 | Conformité LPRPDE, Loi 25 et RGPD dès la conception | Doit | Revue juridique |
| ENF-15 | Serveurs conteneurisés, portables entre hébergeurs | Doit | Déploiement sur deux fournisseurs |
| ENF-16 | Télémétrie : temps d'image, triangles dessinés, profil actif, déconnexions capteurs, erreurs | Doit | Tableau de bord en production |
| ENF-17 | Code TypeScript partagé client/serveur dans un monorepo | Devrait | Revue d'architecture |
| ENF-18 | Ombres temps réel, anticrénelage temporel et lumière indirecte sur tous les profils WebGPU | Devrait | Captures de référence par profil |

## Sources

Principales références consultées les 26 et 27 octobre 2026 ; chaque section cite aussi ses sources sous ses tableaux.

**Plateformes et navigateurs**

- [Three.js en 2026 : versions r182–r186 et prise en charge de WebGPU par navigateur](https://www.utsubo.com/blog/threejs-2026-what-changed)
- [Apple Developer Forums — WebGPU dans WKWebView](https://developer.apple.com/forums/thread/770862)
- [caniuse — Web Bluetooth](https://caniuse.com/web-bluetooth) · [getDevices](https://caniuse.com/mdn-api_bluetooth_getdevices) · [Wake Lock](https://caniuse.com/mdn-api_wakelock_request)
- [GPU for the Web — WebGPU Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- [web-features — WebTransport](https://web-platform-dx.github.io/web-features-explorer/features/webtransport) · [Screen Wake Lock](https://web-platform-dx.github.io/web-features-explorer/features/screen-wake-lock/)

**Capteurs**

- [Bluetooth SIG — Fitness Machine Service 1.0.1](https://files.bluetooth.com/download/ftms_v1-0-1)
- [Capacitor Community — bluetooth-le](https://github.com/capacitor-community/bluetooth-le)
- [Bluefy — Web BLE Browser](https://apps.apple.com/app/id1492822055) · [WebBLE pour Safari](https://apps.apple.com/it/app/ioswebble/id6761301368)
- [Zwift Insider — limite Bluetooth Apple TV](https://zwiftinsider.com/apple-tv-connection-limit) · [DirCon (Wahoo Direct Connect)](https://github.com/Berg0162/DirCon)

**Rendu et moteurs**

- [Three.js — WebGPURenderer](https://threejs.org/manual/en/webgpurenderer) · [SSGINode](https://threejs.org/docs/pages/SSGINode.html) · [VXGINode](https://threejs.org/docs/pages/VXGINode.html)
- [three-virtual-geometry — géométrie virtuelle pour Three.js](https://github.com/elad12390/three-virtual-geometry)
- [Babylon.js 9.0](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0) · [PlayCanvas — Graphics](https://developer.playcanvas.com/user-manual/graphics/)
- [Unity 6.6 et WebGPU](https://app.cinevva.com/news/2026-09-01-unity-6-6-webgpu-production) · [Godot 4.7](https://app.cinevva.com/fr/news/2026-06-19-godot-4-7-released) · [comparatif des moteurs web 2026](https://app.cinevva.com/guides/web-game-engines-comparison.html)

**Livraison, temps réel et backend**

- [Capacitor 8](https://blogs.apievangelist.com/blogs/ionic-2025-12-09-announcing-capacitor-8/) · [Capacitor 9](https://www.plushcap.com/content/ionic/blog/ionic-the-road-to-capacitor-9)
- [Colyseus](https://www.github.com/colyseus/colyseus) · [Nakama](https://heroiclabs.com/blog/unity-multiplayer-backend/) · [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing) · [fin de Hathora](https://docs.edgegap.com/docs/tools-and-integrations/switch-from-hathora)
- [Strava — changements d'API 2026](https://tryterra.co/blog/strava-api-changes-2026) · [Garmin Training API](https://developer.garmin.com/gc-developer-program/training-api) · [TrainingPeaks API](https://help.trainingpeaks.com/hc/en-us/articles/234441128-TrainingPeaks-API) · [intervals.icu API](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090)
- [Garmin FIT JavaScript SDK](https://github.com/garmin/fit-javascript-sdk) · [référence .zwo](https://www.github.com/h4l/zwift-workout-file-reference/blob/master/descriptions.yaml)
- [Règle App Store 4.2 et WebView](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper)
