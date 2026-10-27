export interface RouteSegment {
  lengthM: number;
  gradePct: number;
}

/** Parcours bouclé défini par segments de pente constante. Le dénivelé net doit être nul pour que la boucle soit continue. */
export class Route {
  readonly lengthM: number;
  private readonly starts: number[] = [];
  private readonly alts: number[] = [];

  constructor(readonly name: string, readonly segments: RouteSegment[]) {
    let d = 0;
    let alt = 0;
    for (const s of segments) {
      this.starts.push(d);
      this.alts.push(alt);
      d += s.lengthM;
      alt += (s.lengthM * s.gradePct) / 100;
    }
    this.lengthM = d;
    this.netGainM = alt;
  }

  /** Dénivelé net sur un tour, en m. */
  readonly netGainM: number;

  altitudeAt(distanceM: number): number {
    const laps = Math.floor(distanceM / this.lengthM);
    const d = distanceM - laps * this.lengthM;
    let i = this.starts.length - 1;
    while (i > 0 && this.starts[i]! > d) i--;
    return this.alts[i]! + ((d - this.starts[i]!) * this.segments[i]!.gradePct) / 100 + laps * this.netGainM;
  }

  /** Pente lissée sur une fenêtre de 2 × `halfWindowM`, pour éviter des sauts brutaux de résistance. */
  gradeAt(distanceM: number, halfWindowM = 25): number {
    const rise = this.altitudeAt(distanceM + halfWindowM) - this.altitudeAt(distanceM - halfWindowM);
    return (rise / (2 * halfWindowM)) * 100;
  }
}

/** Parcours de démonstration : 6 km, une montée à 5 % puis sa descente, dénivelé net nul. */
export const DEMO_ROUTE = new Route('Colline', [
  { lengthM: 1000, gradePct: 0 },
  { lengthM: 2000, gradePct: 5 },
  { lengthM: 1000, gradePct: 0 },
  { lengthM: 2000, gradePct: -5 },
]);
