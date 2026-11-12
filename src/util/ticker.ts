/**
 * Minuteur périodique qui ne ralentit pas dans un onglet caché.
 *
 * Chrome espace les `setInterval` de la page à une fois par seconde dans un onglet caché, puis à une fois par
 * minute au bout de cinq minutes. Une sortie ou une séance qui tourne pendant qu'on regarde autre chose perdrait
 * alors sa distance, ses échantillons FIT et ses changements de palier. Les minuteurs d'un Worker dédié ne sont
 * pas soumis à ce ralentissement : le Worker ne fait que battre la mesure, le travail reste sur la page.
 * Sans Worker (tests, navigateur qui le refuse), repli sur `setInterval`.
 */
const WORKER_SRC = `
const timers = new Map();
onmessage = (e) => {
  const { id, ms } = e.data;
  if (ms === undefined) { clearInterval(timers.get(id)); timers.delete(id); return; }
  timers.set(id, setInterval(() => postMessage(id), ms));
};`;

let worker: Worker | null | undefined;
const handlers = new Map<number, () => void>();
let nextId = 1;

function tickWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = (e: MessageEvent<number>) => handlers.get(e.data)?.();
  } catch {
    worker = null;
  }
  return worker;
}

/** Appelle `fn` toutes les `ms` millisecondes ; renvoie de quoi l'arrêter. */
export function every(ms: number, fn: () => void): () => void {
  const w = typeof Worker === 'undefined' ? null : tickWorker();
  if (!w) {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }
  const id = nextId++;
  handlers.set(id, fn);
  w.postMessage({ id, ms });
  return () => {
    handlers.delete(id);
    w.postMessage({ id });
  };
}
