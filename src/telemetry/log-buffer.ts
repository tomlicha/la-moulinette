import { LIMITS, type Level, type LogEntry } from './report';

/**
 * Les dernières lignes du journal, en mémoire : ce qui précède une erreur est ce qui permet de la comprendre.
 * Le niveau est donné par l'appelant, qui sait si la ligne décrit une panne ; rien n'est deviné d'après les mots.
 */
export class LogBuffer {
  private entries: LogEntry[] = [];
  private seq = 0;

  constructor(
    private readonly max = 300,
    private readonly now: () => number = Date.now,
  ) {}

  add(msg: string, level: Level = 'info'): LogEntry {
    const entry: LogEntry = { n: ++this.seq, t: this.now(), level, msg: msg.slice(0, LIMITS.msgChars) };
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    return entry;
  }

  /** Les lignes numérotées au-delà de `afterN`, dans l'ordre. */
  since(afterN: number): LogEntry[] {
    return this.entries.filter((e) => e.n > afterN);
  }
}
