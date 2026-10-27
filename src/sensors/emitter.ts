import type { SensorEvents } from './types';

type AnyFn = (...args: never[]) => void;

export class Emitter {
  private handlers = new Map<keyof SensorEvents, AnyFn[]>();

  on<K extends keyof SensorEvents>(ev: K, fn: SensorEvents[K]): void {
    const list = this.handlers.get(ev) ?? [];
    list.push(fn as AnyFn);
    this.handlers.set(ev, list);
  }

  protected emit<K extends keyof SensorEvents>(ev: K, ...args: Parameters<SensorEvents[K]>): void {
    for (const fn of this.handlers.get(ev) ?? []) (fn as (...a: unknown[]) => void)(...args);
  }
}
