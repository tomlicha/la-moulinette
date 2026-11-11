/**
 * Contrat entre les modèles 3D (`public/assets/*.glb`) et le moteur. Un modèle fait dans Blender peut remplacer
 * un modèle généré s'il respecte ce contrat.
 *
 * Repère : mètres, +Y en haut, +Z vers l'avant du vélo, +X à gauche du cycliste ; origine au sol sous le pédalier.
 *
 * Avatar (`avatar.glb`) : un maillage à squelette posé en position de pédalage. Chaque os a son axe +Y le long
 * de l'os, vers l'articulation suivante, et son axe +X vers la gauche du cycliste (os « roll » nul).
 *
 * Vélo (`bike.glb`) : nœuds nommés pour les pièces mobiles et les points d'appui du cycliste.
 *
 * Couleurs : chaque sommet porte un attribut `_REGION` (entier stocké en flottant) qui désigne une zone du
 * tableau ci-dessous ; le moteur y applique la palette du coureur (maillot, vélo…). `COLOR_0` contient la palette
 * par défaut pour les visionneuses glTF ordinaires.
 *
 * Ce fichier n'importe rien : le script de génération (Node) l'importe tel quel.
 */

export const BONE = {
  pelvis: 'pelvis',
  spine: 'spine',
  chest: 'chest',
  neck: 'neck',
  head: 'head',
  thighL: 'thigh_l',
  shinL: 'shin_l',
  footL: 'foot_l',
  thighR: 'thigh_r',
  shinR: 'shin_r',
  footR: 'foot_r',
  upperArmL: 'upperarm_l',
  forearmL: 'forearm_l',
  handL: 'hand_l',
  upperArmR: 'upperarm_r',
  forearmR: 'forearm_r',
  handR: 'hand_r',
} as const;

export const BIKE_NODE = {
  frontWheel: 'wheel_front',
  rearWheel: 'wheel_rear',
  /** Pédalier : tourne autour de l'axe X à la cadence ; porte les deux pédales. */
  crankset: 'crankset',
  pedalL: 'pedal_l',
  pedalR: 'pedal_r',
  /** Points d'appui (nœuds vides) : assise sur la selle, prise des mains sur les cocottes. */
  saddle: 'anchor_saddle',
  hoodL: 'anchor_hood_l',
  hoodR: 'anchor_hood_r',
} as const;

export const REGION = {
  skin: 0,
  hair: 1,
  jersey: 2,
  jerseyAlt: 3,
  jerseyAccent: 4,
  shorts: 5,
  shortsBand: 6,
  sock: 7,
  shoe: 8,
  sole: 9,
  glove: 10,
  helmet: 11,
  helmetAlt: 12,
  liner: 13,
  lens: 14,
  eyewear: 15,
  frame: 16,
  frameAlt: 17,
  carbon: 18,
  alloy: 19,
  rubber: 20,
  tape: 21,
  saddle: 22,
  decal: 23,
  steel: 24,
  chain: 25,
  eyeWhite: 26,
  iris: 27,
  pupil: 28,
} as const;

export type RegionName = keyof typeof REGION;
export const REGION_COUNT = 29;

/** Couleur sRGB et réponse à la lumière d'une zone. */
export interface Finish {
  color: number;
  roughness: number;
  metalness: number;
}

const f = (color: number, roughness: number, metalness = 0): Finish => ({ color, roughness, metalness });

/** Palette par défaut, reprise de la planche de style (maillot turquoise, vélo turquoise). */
export const DEFAULT_FINISH: Record<RegionName, Finish> = {
  skin: f(0xd9a47e, 0.55),
  hair: f(0x5a3b24, 0.7),
  jersey: f(0x5be3c9, 0.62),
  jerseyAlt: f(0x14202e, 0.62),
  jerseyAccent: f(0xf4f4f0, 0.55),
  shorts: f(0x16181d, 0.6),
  shortsBand: f(0xf4f4f0, 0.5),
  sock: f(0x5be3c9, 0.7),
  shoe: f(0x1d2026, 0.35),
  sole: f(0x0d0e10, 0.5),
  glove: f(0x16181d, 0.65),
  helmet: f(0xf4f4f0, 0.3),
  helmetAlt: f(0x5be3c9, 0.3),
  liner: f(0x111214, 0.8),
  lens: f(0xff8a3c, 0.08, 0.6),
  eyewear: f(0x111214, 0.3),
  frame: f(0x5be3c9, 0.22, 0.15),
  frameAlt: f(0x14202e, 0.25, 0.1),
  carbon: f(0x15171a, 0.35),
  alloy: f(0xb9bec6, 0.3, 0.9),
  rubber: f(0x141518, 0.85),
  tape: f(0x16181d, 0.8),
  saddle: f(0x16181d, 0.55),
  decal: f(0xf4f4f0, 0.35),
  steel: f(0xd4d7dc, 0.22, 1),
  chain: f(0x6d7178, 0.4, 0.9),
  eyeWhite: f(0xece7df, 0.25),
  iris: f(0x5a4030, 0.2),
  pupil: f(0x0c0c0d, 0.15),
};

export const REGION_NAMES = Object.keys(REGION) as RegionName[];
