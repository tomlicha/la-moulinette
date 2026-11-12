/**
 * Ce qu'on sait de chaque famille de home trainers : marque, protocole de pilotage à préférer, pente maximale.
 * L'identification croise le nom Bluetooth et le service Device Information (fabricant, modèle, firmware).
 *
 * Pentes maximales : chiffres des fabricants, recoupés le 11 novembre 2026 (fiches Wahoo et Elite, tests DC Rainmaker,
 * BikeRadar, Zwift Insider, revendeurs). Garmin les calcule pour 65 kg à 10 km/h : un cycliste plus lourd atteint la
 * limite du frein plus tôt. Elles évitent d'envoyer une pente que le trainer ne sait pas rendre ; un modèle sans
 * chiffre confirmé n'est pas plafonné.
 */

/** Protocoles de pilotage, du standard au propriétaire. */
export type ControlProtocol = 'ftms' | 'wahoo' | 'fec';

export const PROTOCOL_LABEL: Record<ControlProtocol, string> = {
  ftms: 'FTMS',
  wahoo: 'Wahoo',
  fec: 'FE-C over BLE',
};

export const ALL_PROTOCOLS: ControlProtocol[] = ['ftms', 'wahoo', 'fec'];

export type Brand = 'wahoo' | 'tacx' | 'elite' | 'autre';

export interface DeviceInfo {
  manufacturer?: string;
  model?: string;
  hardware?: string;
  firmware?: string;
  software?: string;
}

export interface TrainerProfile {
  id: string;
  brand: Brand;
  /** Nom lisible de la famille, affiché à l'utilisateur. */
  label: string;
  /** Ordre de préférence ; les protocoles absents de la liste restent essayés ensuite. */
  protocols: ControlProtocol[];
  maxGradePct?: number;
  /** Trainer à roue : la vitesse dépend du diamètre de roue et du serrage du rouleau. */
  wheelOn?: boolean;
}

interface ProfileRule extends Omit<TrainerProfile, 'brand' | 'protocols'> {
  /** Comparé au nom Bluetooth puis au numéro de modèle. */
  match: RegExp;
}

/**
 * Wahoo : le protocole propriétaire existe sur tous les KICKR, quel que soit le firmware ; FTMS n'est arrivé qu'en 2021
 * (KICKR 2018 en 3.5.1, CORE en 1.1.1, KICKR v5 en 4.2.1) et des régressions y ont été signalées sur le KICKR v5.
 */
const WAHOO: ProfileRule[] = [
  { id: 'kickr-bike', label: 'Wahoo KICKR BIKE', match: /KICKR\s*BIKE/i, maxGradePct: 20 },
  { id: 'kickr-core', label: 'Wahoo KICKR CORE', match: /KICKR\s*CORE/i, maxGradePct: 16 },
  { id: 'kickr-snap', label: 'Wahoo KICKR SNAP', match: /KICKR\s*SNAP/i, maxGradePct: 12, wheelOn: true },
  { id: 'kickr-rollr', label: 'Wahoo KICKR ROLLR', match: /KICKR\s*ROLLR/i, maxGradePct: 10, wheelOn: true },
  { id: 'kickr-move', label: 'Wahoo KICKR MOVE', match: /KICKR\s*MOVE/i, maxGradePct: 20 },
  { id: 'kickr', label: 'Wahoo KICKR', match: /KICKR|WAHOO/i, maxGradePct: 20 },
];

/**
 * Tacx : FTMS sur les modèles et firmwares récents ; FE-C over BLE partout, y compris là où FTMS n'est jamais arrivé
 * (NEO 1, Vortex, Bushido, Genius, FLUX 2 avant 5.0.0, NEO Bike avant 4.5.0).
 */
const TACX: ProfileRule[] = [
  { id: 'tacx-neo', label: 'Tacx NEO', match: /NEO/i, maxGradePct: 25 },
  { id: 'tacx-flux-2', label: 'Tacx FLUX 2', match: /FLUX[\s-]*2/i, maxGradePct: 16 },
  { id: 'tacx-flux', label: 'Tacx FLUX', match: /FLUX/i, maxGradePct: 10 },
  { id: 'tacx-vortex', label: 'Tacx Vortex', match: /VORTEX/i, maxGradePct: 7, wheelOn: true },
  { id: 'tacx-flow', label: 'Tacx Flow', match: /FLOW/i, maxGradePct: 6, wheelOn: true },
  { id: 'tacx-bushido', label: 'Tacx Bushido', match: /BUSHIDO/i, maxGradePct: 15, wheelOn: true },
  { id: 'tacx-genius', label: 'Tacx Genius', match: /GENIUS/i, maxGradePct: 20, wheelOn: true },
  { id: 'tacx', label: 'Tacx', match: /TACX/i },
];

/** Elite : FTMS sur toute la gamme connectée récente. */
const ELITE: ProfileRule[] = [
  { id: 'elite-direto-xr', label: 'Elite Direto XR', match: /DIRETO\s*XR/i, maxGradePct: 24 },
  { id: 'elite-direto-x', label: 'Elite Direto X', match: /DIRETO\s*X\b/i, maxGradePct: 18 },
  { id: 'elite-direto-ii', label: 'Elite Direto II', match: /DIRETO\s*(II|2)\b/i }, // pente maximale non trouvée
  { id: 'elite-direto', label: 'Elite Direto', match: /DIRETO/i, maxGradePct: 14 },
  { id: 'elite-justo', label: 'Elite Justo', match: /JUSTO/i, maxGradePct: 24 },
  { id: 'elite-drivo', label: 'Elite Drivo', match: /DRIVO/i, maxGradePct: 24 },
  { id: 'elite-suito', label: 'Elite Suito', match: /SUITO/i, maxGradePct: 15 },
  { id: 'elite-zumo', label: 'Elite Zumo', match: /ZUMO/i, maxGradePct: 12 },
  { id: 'elite-tuo', label: 'Elite Tuo', match: /\bTUO/i, maxGradePct: 10 },
  { id: 'elite-avanti', label: 'Elite Avanti', match: /AVANTI/i, maxGradePct: 18 },
  { id: 'elite-novo', label: 'Elite Novo', match: /NOVO|NERO/i, wheelOn: true }, // pente maximale non trouvée
  { id: 'elite', label: 'Elite', match: /ELITE/i },
];

const BRANDS: { brand: Exclude<Brand, 'autre'>; manufacturer: RegExp; name: RegExp; protocols: ControlProtocol[]; rules: ProfileRule[] }[] = [
  { brand: 'wahoo', manufacturer: /WAHOO/i, name: /KICKR|WAHOO/i, protocols: ['wahoo', 'ftms'], rules: WAHOO },
  { brand: 'tacx', manufacturer: /TACX|GARMIN/i, name: /TACX/i, protocols: ['ftms', 'fec'], rules: TACX },
  {
    brand: 'elite',
    manufacturer: /ELITE/i,
    name: /ELITE|DIRETO|JUSTO|DRIVO|SUITO|ZUMO|\bTUO|AVANTI|NOVO|NERO/i,
    protocols: ['ftms'],
    rules: ELITE,
  },
];

const GENERIC: TrainerProfile = { id: 'generique', brand: 'autre', label: 'Home trainer', protocols: ['ftms', 'wahoo', 'fec'] };

/** Famille du trainer, d'après son nom Bluetooth et ses informations d'appareil. */
export function identifyTrainer(name = '', info: DeviceInfo = {}): TrainerProfile {
  const text = [name, info.model ?? ''].join(' ');
  const brand = BRANDS.find((b) => (info.manufacturer && b.manufacturer.test(info.manufacturer)) || b.name.test(text));
  if (!brand) return GENERIC;
  const rule = brand.rules.find((r) => r.match.test(text)) ?? brand.rules.at(-1)!;
  const { match: _match, ...profile } = rule;
  return { ...profile, brand: brand.brand, protocols: brand.protocols };
}

/** Protocoles à essayer, dans l'ordre : celui imposé d'abord, puis les préférences du profil, puis le reste. */
export function protocolOrder(profile: TrainerProfile, forced?: ControlProtocol): ControlProtocol[] {
  const order = [...(forced ? [forced] : []), ...profile.protocols, ...ALL_PROTOCOLS];
  return order.filter((p, i) => order.indexOf(p) === i);
}

const UPDATER: Record<Brand, string> = {
  wahoo: "l'app Wahoo",
  tacx: "l'app Tacx Training",
  elite: "l'app My E-Training d'Elite",
  autre: "l'app du fabricant",
};

/**
 * Conseil à afficher quand le trainer n'est pas pilotable : chez les trois grandes marques, c'est presque toujours
 * un firmware antérieur à l'arrivée de FTMS.
 */
export function firmwareAdvice(profile: TrainerProfile, info: DeviceInfo = {}): string {
  const fw = info.firmware ? ` (firmware ${info.firmware})` : '';
  return `${profile.label}${fw} : aucun mode de pilotage trouvé, lecture seule. Mets à jour son firmware avec ${UPDATER[profile.brand]}, puis reconnecte-le.`;
}

/**
 * Préfixes de noms Bluetooth proposés dans le sélecteur, en plus des filtres par service : certains trainers
 * n'annoncent pas FTMS ni Cycling Power dans leurs paquets d'annonce. Comparaison sensible à la casse.
 */
export const TRAINER_NAME_PREFIXES = [
  'KICKR', 'Wahoo', 'WAHOO',
  'Tacx', 'TACX', 'NEO', 'Neo', 'FLUX', 'Flux',
  'Elite', 'ELITE', 'DIRETO', 'Direto', 'JUSTO', 'Justo', 'DRIVO', 'Drivo', 'SUITO', 'Suito', 'ZUMO', 'Zumo',
  'TUO', 'Tuo', 'AVANTI', 'Avanti', 'NOVO', 'Novo',
  'Saris', 'SARIS', 'H3', 'Zwift Hub', 'HUB', 'Wattbike', 'ATOM', 'Van Rysel', 'D100', 'D500', 'Magene', 'Thinkrider',
  'JetBlack', 'Kinetic', 'Stages', 'Kurt',
];
