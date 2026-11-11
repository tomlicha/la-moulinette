import { browserStore, type KeyValueStore } from '../sensors/device-registry';
import type { EditorBlock } from './blocks';

export interface SavedWorkout {
  id: string;
  name: string;
  description?: string;
  blocks: EditorBlock[];
  updatedAt: number;
}

const KEY = 'zwift2.workouts';

/**
 * Séances créées dans l'éditeur, gardées dans le navigateur de l'utilisateur.
 * Ce n'est qu'un stockage local : elles ne suivent pas l'utilisateur d'un appareil à l'autre (il faudra le backend).
 */
export class WorkoutLibrary {
  constructor(
    private readonly store: KeyValueStore = browserStore(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  list(): SavedWorkout[] {
    try {
      const raw = JSON.parse(this.store.getItem(KEY) ?? '[]') as unknown;
      if (!Array.isArray(raw)) return [];
      return (raw as SavedWorkout[])
        .filter((w) => w && typeof w.id === 'string' && typeof w.name === 'string' && Array.isArray(w.blocks))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  get(id: string): SavedWorkout | undefined {
    return this.list().find((w) => w.id === id);
  }

  /** Crée la séance si elle n'a pas d'identifiant, sinon la remplace. Renvoie la version enregistrée. */
  save(w: Omit<SavedWorkout, 'id' | 'updatedAt'> & { id?: string }, now = Date.now()): SavedWorkout {
    const saved: SavedWorkout = { ...w, id: w.id ?? this.newId(), updatedAt: now };
    this.write([saved, ...this.list().filter((x) => x.id !== saved.id)]);
    return saved;
  }

  remove(id: string) {
    this.write(this.list().filter((w) => w.id !== id));
  }

  private write(list: SavedWorkout[]) {
    this.store.setItem(KEY, JSON.stringify(list)); // une erreur de quota remonte : l'éditeur doit dire que l'enregistrement a échoué
  }
}
