import type { SensorEvents } from './types';

type AnyFn = (...args: never[]) => void;

export class Emitter {
  private handlers = new Map<keyof SensorEvents, AnyFn[]>();

  /** Abonne `fn` ; renvoie de quoi le désabonner. */
  on<K extends keyof SensorEvents>(ev: K, fn: SensorEvents[K]): () => void {
    const list = this.handlers.get(ev) ?? [];
    list.push(fn as AnyFn);
    this.handlers.set(ev, list);
    return () => this.off(ev, fn);
  }

  off<K extends keyof SensorEvents>(ev: K, fn: SensorEvents[K]): void {
    const list = this.handlers.get(ev);
    if (!list) return;
    const i = list.indexOf(fn as AnyFn);
    if (i >= 0) list.splice(i, 1);
  }

  protected emit<K extends keyof SensorEvents>(ev: K, ...args: Parameters<SensorEvents[K]>): void {
    // Copie : un écouteur peut se désabonner pendant l'émission.
    for (const fn of [...(this.handlers.get(ev) ?? [])]) (fn as (...a: unknown[]) => void)(...args);
  }
}
