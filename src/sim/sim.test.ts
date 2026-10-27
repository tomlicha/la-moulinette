import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER, resistanceForce, step, steadySpeed } from './physics';
import { DEMO_ROUTE, Route } from './route';
import { Ride, STEP_MS } from './ride';
import { GradeThrottle } from './grade-throttle';

const kmh = (ms: number) => ms * 3.6;

/** Intègre `seconds` secondes à puissance et pente constantes, depuis `v0`. */
function integrate(power: number, grade: number, seconds: number, v0 = 0) {
  let v = v0;
  for (let t = 0; t < seconds; t += 0.05) v = step(v, power, grade, 0.05, DEFAULT_RIDER).v;
  return v;
}

describe('physique', () => {
  it('250 W à plat donne environ 37 km/h', () => {
    expect(kmh(steadySpeed(250, 0, DEFAULT_RIDER))).toBeGreaterThan(36);
    expect(kmh(steadySpeed(250, 0, DEFAULT_RIDER))).toBeLessThan(38.5);
  });

  it("l'intégration converge vers la vitesse d'équilibre", () => {
    for (const [power, grade] of [[250, 0], [250, 5], [150, -2], [0, -5], [400, 8]] as const) {
      const eq = steadySpeed(power, grade, DEFAULT_RIDER);
      expect(integrate(power, grade, 300, 0)).toBeCloseTo(eq, 1);
    }
  });

  it("à l'équilibre, la puissance transmise compense la résistance", () => {
    const v = steadySpeed(300, 3, DEFAULT_RIDER);
    expect(resistanceForce(v, 3, DEFAULT_RIDER) * v).toBeCloseTo(DEFAULT_RIDER.efficiency * 300, 3);
  });

  it("monter est plus lent que rouler à plat, descendre plus rapide, à puissance égale", () => {
    const flat = steadySpeed(250, 0, DEFAULT_RIDER);
    expect(steadySpeed(250, 5, DEFAULT_RIDER)).toBeLessThan(flat);
    expect(steadySpeed(250, -5, DEFAULT_RIDER)).toBeGreaterThan(flat);
  });

  it('sans pédaler à plat, la vitesse décroît sans devenir négative', () => {
    let v = 10;
    let prev = v;
    for (let i = 0; i < 20000; i++) {
      v = step(v, 0, 0, 0.05, DEFAULT_RIDER).v;
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      prev = v;
    }
    expect(v).toBe(0);
  });

  it('démarre depuis l\'arrêt sans division par zéro', () => {
    const r = step(0, 200, 0, 0.05, DEFAULT_RIDER);
    expect(Number.isFinite(r.v)).toBe(true);
    expect(r.v).toBeGreaterThan(0);
  });

  it("reste à l'arrêt si la pente dépasse ce que la puissance peut gravir", () => {
    expect(integrate(20, 15, 30, 0)).toBeLessThan(0.5);
  });

  it('un vent de face ralentit, un vent arrière accélère', () => {
    const at = (w: number) => {
      let v = 8;
      for (let i = 0; i < 2000; i++) v = step(v, 250, 0, 0.05, DEFAULT_RIDER, w).v;
      return v;
    };
    expect(at(5)).toBeLessThan(at(0));
    expect(at(-5)).toBeGreaterThan(at(0));
  });
});

describe('parcours', () => {
  it('la boucle de démonstration est fermée (dénivelé net nul)', () => {
    expect(DEMO_ROUTE.netGainM).toBeCloseTo(0, 9);
    expect(DEMO_ROUTE.lengthM).toBe(6000);
  });

  it('donne la pente du segment, lissée aux jonctions', () => {
    expect(DEMO_ROUTE.gradeAt(500)).toBeCloseTo(0, 9);
    expect(DEMO_ROUTE.gradeAt(2000)).toBeCloseTo(5, 9);
    expect(DEMO_ROUTE.gradeAt(1000)).toBeCloseTo(2.5, 9); // moitié à plat, moitié à 5 %
    expect(DEMO_ROUTE.gradeAt(5000)).toBeCloseTo(-5, 9);
  });

  it("l'altitude suit la pente et se répète à chaque tour", () => {
    expect(DEMO_ROUTE.altitudeAt(1000)).toBeCloseTo(0, 9);
    expect(DEMO_ROUTE.altitudeAt(3000)).toBeCloseTo(100, 9);
    expect(DEMO_ROUTE.altitudeAt(6000 + 3000)).toBeCloseTo(100, 9);
  });

  it('accepte un tour qui ne se referme pas, en cumulant le dénivelé', () => {
    const r = new Route('rampe', [{ lengthM: 1000, gradePct: 10 }]);
    expect(r.altitudeAt(1500)).toBeCloseTo(150, 9);
  });
});

describe('sortie virtuelle', () => {
  it('ne dépend pas du découpage des appels', () => {
    const a = new Ride(DEMO_ROUTE);
    const b = new Ride(DEMO_ROUTE);
    for (let i = 0; i < 400; i++) a.advance(0.25, 250);
    b.advance(1, 250); // plafonné à 1 s par appel : on alimente seconde par seconde
    for (let i = 0; i < 99; i++) b.advance(1, 250);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('avance de façon identique pour deux sorties aux mêmes entrées', () => {
    const run = () => {
      const r = new Ride(DEMO_ROUTE);
      for (let i = 0; i < 600; i++) r.advance(0.1, 200 + (i % 50));
      return r.snapshot();
    };
    expect(run()).toEqual(run());
  });

  it("abandonne le temps au-delà du plafond de rattrapage (onglet en veille)", () => {
    const r = new Ride(DEMO_ROUTE);
    r.advance(3600, 250);
    expect(r.snapshot().elapsedS).toBeCloseTo(1, 9);
  });

  it('monte la colline : la pente et la vitesse suivent le relief', () => {
    const r = new Ride(DEMO_ROUTE);
    let flat = 0;
    let climb = 0;
    for (let i = 0; i < 20 * 600; i++) {
      const s = r.advance(0.05, 250);
      if (s.distanceM > 400 && s.distanceM < 900) flat = s.speedKmh;
      if (s.gradePct > 4.9) climb = s.speedKmh;
    }
    expect(flat).toBeGreaterThan(30);
    expect(climb).toBeGreaterThan(14);
    expect(climb).toBeLessThan(flat - 10);
    expect(STEP_MS).toBe(50);
  });
});

describe('GradeThrottle', () => {
  it('envoie la première valeur, puis seulement un changement notable et espacé', () => {
    const t = new GradeThrottle(0.5, 1000);
    expect(t.shouldSend(0, 0)).toBe(true);
    t.markSent(0, 0);
    expect(t.shouldSend(3, 500)).toBe(false); // trop tôt
    expect(t.shouldSend(0.2, 2000)).toBe(false); // trop faible
    expect(t.shouldSend(0.6, 2000)).toBe(true);
    t.markSent(0.6, 2000);
    expect(t.shouldSend(-3, 2500)).toBe(false);
    expect(t.shouldSend(-3, 3000)).toBe(true);
  });

  it('renvoie après un reset (reconnexion, nouvelle sortie)', () => {
    const t = new GradeThrottle();
    t.markSent(2, 0);
    t.reset();
    expect(t.shouldSend(2, 1)).toBe(true);
  });
});
