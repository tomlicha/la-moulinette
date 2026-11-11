import type { Level, LogEntry } from './report';

/** Les messages du journal sont du texte libre : on reconnaît les échecs à leurs mots, faute de niveau explicite. */
const ERROR_RE =
  /échec|échoué|refus|illisible|non (?:envoy|rejou|activ)|indisponible|perdue|abandonn|impossible|erreur|\berror\b|exception|unhandled/i;

export function classify(msg: string): Level {
  return ERROR_RE.test(msg) ? 'error' : 'info';
}

/** Les dernières lignes du journal, en mémoire : ce qui précède une erreur est ce qui permet de la comprendre. */
export class LogBuffer {
  private entries: LogEntry[] = [];
  private seq = 0;

  constructor(
    private readonly max = 300,
    private readonly now: () => number = Date.now,
  ) {}

  add(msg: string, level: Level = classify(msg)): LogEntry {
    const entry: LogEntry = { n: ++this.seq, t: this.now(), level, msg };
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    return entry;
  }

  /** Les lignes numérotées au-delà de `afterN`, dans l'ordre. */
  since(afterN: number): LogEntry[] {
    return this.entries.filter((e) => e.n > afterN);
  }
}
