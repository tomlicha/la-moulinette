import { browserStore, type KeyValueStore } from '../sensors/device-registry';
import type { EditorBlock } from './blocks';

export interface SavedBlock {
  id: string;
  name: string;
  blocks: EditorBlock[];
  updatedAt: number;
}

const KEY = 'zwift2.blocks';

/** « Mes blocs » : blocs mis de côté par l'utilisateur depuis l'éditeur, gardés dans son navigateur (comme les séances). */
export class BlockLibrary {
  constructor(
    private readonly store: KeyValueStore = browserStore(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  list(): SavedBlock[] {
    try {
      const raw = JSON.parse(this.store.getItem(KEY) ?? '[]') as unknown;
      if (!Array.isArray(raw)) return [];
      return (raw as SavedBlock[])
        .filter((b) => b && typeof b.id === 'string' && typeof b.name === 'string' && Array.isArray(b.blocks) && b.blocks.length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /** Ajoute le bloc (ou les blocs) à la bibliothèque ; une erreur de quota remonte : l'éditeur doit dire que c'est raté. */
  save(name: string, blocks: EditorBlock[], now = Date.now()): SavedBlock {
    const saved: SavedBlock = { id: this.newId(), name: name.trim() || 'Bloc sans nom', blocks: structuredClone(blocks), updatedAt: now };
    this.store.setItem(KEY, JSON.stringify([saved, ...this.list()]));
    return saved;
  }

  remove(id: string) {
    this.store.setItem(KEY, JSON.stringify(this.list().filter((b) => b.id !== id)));
  }
}
