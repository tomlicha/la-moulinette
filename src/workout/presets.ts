import { blockDurationS, BLOCK_LABEL, defaultBlock, type BlockType, type EditorBlock } from './blocks';

/**
 * Blocs préfaits de l'étagère de l'écran Séances (docs/design/seances.md, piste S) : des blocs d'entraînement qui ont un
 * sens (nom, durée et intensité connus), rangés par type donc par zone de couleur. Les puissances sont des fractions de FTP.
 */
export type PresetCategory = 'warm' | 'endu' | 'sweet' | 'thr' | 'vo2' | 'spr' | 'cool';

export interface PresetCategoryInfo {
  id: PresetCategory;
  name: string;
  /** Zone de couleur de la pastille (voir `zoneOf`). */
  zone: 'z1' | 'z2' | 'z3' | 'z4' | 'z5' | 'z6';
}

export const PRESET_CATEGORIES: PresetCategoryInfo[] = [
  { id: 'warm', name: 'Échauffement', zone: 'z2' },
  { id: 'endu', name: 'Endurance', zone: 'z2' },
  { id: 'sweet', name: 'Sweet spot', zone: 'z3' },
  { id: 'thr', name: 'Seuil', zone: 'z4' },
  { id: 'vo2', name: 'VO2 max', zone: 'z5' },
  { id: 'spr', name: 'Sprint', zone: 'z6' },
  { id: 'cool', name: 'Retour au calme', zone: 'z1' },
];

export interface BlockPreset {
  id: string;
  category: PresetCategory;
  name: string;
  blocks: EditorBlock[];
}

const intervals = (repeat: number, onS: number, onPower: number, offS: number, offPower: number): EditorBlock => ({ type: 'intervals', repeat, onS, offS, onPower, offPower });

export const BLOCK_PRESETS: BlockPreset[] = [
  { id: 'warm-progressive', category: 'warm', name: 'Progressif', blocks: [{ type: 'warmup', durationS: 600, from: 0.45, to: 0.75 }] },
  { id: 'warm-accel', category: 'warm', name: 'Avec 3 accélérations', blocks: [{ type: 'warmup', durationS: 360, from: 0.45, to: 0.65 }, intervals(3, 30, 1.15, 90, 0.55)] },
  { id: 'endu-20', category: 'endu', name: 'Endurance 20 min', blocks: [{ type: 'steady', durationS: 1200, power: 0.65 }] },
  { id: 'endu-45', category: 'endu', name: 'Endurance 45 min', blocks: [{ type: 'steady', durationS: 2700, power: 0.7 }] },
  { id: 'sweet-2x20', category: 'sweet', name: 'Sweet spot 2×20', blocks: [intervals(2, 1200, 0.9, 300, 0.55)] },
  { id: 'sweet-3x12', category: 'sweet', name: 'Sweet spot 3×12', blocks: [intervals(3, 720, 0.9, 240, 0.55)] },
  { id: 'thr-3x10', category: 'thr', name: 'Seuil 3×10', blocks: [intervals(3, 600, 1, 300, 0.55)] },
  { id: 'thr-2x20', category: 'thr', name: 'Seuil 2×20', blocks: [intervals(2, 1200, 1, 360, 0.55)] },
  { id: 'vo2-5x4', category: 'vo2', name: 'VO2 5×4', blocks: [intervals(5, 240, 1.2, 240, 0.5)] },
  { id: 'vo2-6x3', category: 'vo2', name: 'VO2 6×3', blocks: [intervals(6, 180, 1.18, 180, 0.5)] },
  { id: 'spr-30-30', category: 'spr', name: '30/30 × 10', blocks: [intervals(10, 30, 1.28, 30, 0.5)] },
  { id: 'spr-15s', category: 'spr', name: 'Sprints 8×15 s', blocks: [intervals(8, 15, 1.5, 120, 0.5)] },
  { id: 'cool-10', category: 'cool', name: 'Retour au calme', blocks: [{ type: 'cooldown', durationS: 600, from: 0.65, to: 0.4 }] },
  { id: 'cool-down', category: 'cool', name: 'Descente progressive', blocks: [{ type: 'cooldown', durationS: 480, from: 0.7, to: 0.35 }] },
];

/** Blocs vierges : les six types, avec leurs valeurs par défaut, à retoucher (ce que proposaient les anciens boutons d'ajout). */
export const BLANK_TYPES: BlockType[] = ['warmup', 'steady', 'intervals', 'ramp', 'free', 'cooldown'];
export const blankPresets = (): { id: string; name: string; blocks: EditorBlock[] }[] =>
  BLANK_TYPES.map((t) => ({ id: `blank-${t}`, name: BLOCK_LABEL[t], blocks: [defaultBlock(t)] }));

/** Puissance « principale » d'un bloc, en fraction de FTP : l'effort pour des intervalles, la plus haute pour une montée. */
export function mainPower(b: EditorBlock): number | undefined {
  switch (b.type) {
    case 'intervals':
      return b.onPower;
    case 'steady':
      return b.power;
    case 'free':
      return undefined;
    default:
      return Math.max(b.from, b.to);
  }
}

export interface PresetSummary {
  durationS: number;
  /** Intensité principale en fraction de FTP ; `undefined` pour un bloc libre. */
  power?: number;
}

/** Durée totale et intensité principale d'un ensemble de blocs, pour l'étiquette d'une carte. */
export function summarizeBlocks(blocks: EditorBlock[]): PresetSummary {
  const powers = blocks.map(mainPower).filter((p): p is number => p !== undefined);
  return { durationS: blocks.reduce((t, b) => t + blockDurationS(b), 0), power: powers.length ? Math.max(...powers) : undefined };
}
