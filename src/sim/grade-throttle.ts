/**
 * Décide quand renvoyer la pente au trainer : un changement notable, et pas plus d'une fois par `minIntervalMs`.
 * Chaque envoi coûte une écriture BLE et une réponse ; le trainer n'a pas besoin de 20 mises à jour par seconde.
 */
export class GradeThrottle {
  private lastSent?: { gradePct: number; at: number };

  constructor(
    private readonly minDeltaPct = 0.5,
    private readonly minIntervalMs = 1000,
  ) {}

  shouldSend(gradePct: number, nowMs: number): boolean {
    const last = this.lastSent;
    if (!last) return true;
    return nowMs - last.at >= this.minIntervalMs && Math.abs(gradePct - last.gradePct) >= this.minDeltaPct;
  }

  markSent(gradePct: number, nowMs: number) {
    this.lastSent = { gradePct, at: nowMs };
  }

  reset() {
    this.lastSent = undefined;
  }
}
