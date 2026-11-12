import { describe, expect, it } from 'vitest';
import { DEMO_ROUTE, Route } from '../sim/route';
import { ClimbCounter, fmt1, nextSummitM, PowerAverage, routeProfile, signed, summitsOf, zoneLabel } from './hud-model';

describe('PowerAverage', () => {
  it('moyenne les mesures des 3 dernières secondes', () => {
    const p = new PowerAverage();
    p.push(100, 0);
    p.push(200, 1000);
    p.push(300, 2000);
    expect(p.value(2000)).toBe(200);
    p.push(400, 3500); // la mesure à 0 s sort de la fenêtre
    expect(p.value(3500)).toBe(300);
  });

  it('se tait quand le capteur se tait', () => {
    const p = new PowerAverage();
    p.push(250, 0);
    expect(p.value(3001)).toBeUndefined();
  });
});

describe('ClimbCounter', () => {
  it('ne cumule que les montées', () => {
    const c = new ClimbCounter();
    for (const a of [100, 105, 103, 110, 90]) c.add(a);
    expect(c.total).toBe(12);
    c.reset();
    c.add(50);
    expect(c.total).toBe(0);
  });
});

describe('sommets', () => {
  it('trouve le haut de la montée du parcours de démonstration', () => {
    expect(summitsOf(DEMO_ROUTE)).toEqual([3000]);
  });

  it('compte jusqu’au prochain sommet, tour suivant compris', () => {
    expect(nextSummitM(DEMO_ROUTE, 400)).toBe(2600);
    expect(nextSummitM(DEMO_ROUTE, 3500)).toBe(5500);
    expect(nextSummitM(DEMO_ROUTE, 6400)).toBe(2600);
  });

  it('ne trouve rien sur un parcours plat', () => {
    expect(nextSummitM(new Route('Plat', [{ lengthM: 1000, gradePct: 0 }]), 10)).toBeUndefined();
  });
});

describe('routeProfile', () => {
  it('place le sommet en haut et le départ en bas du repère', () => {
    const p = routeProfile(DEMO_ROUTE, 600, 34);
    expect(p.x(3000)).toBe(300);
    expect(p.y(DEMO_ROUTE.altitudeAt(3000))).toBeCloseTo(3);
    expect(p.y(DEMO_ROUTE.altitudeAt(0))).toBeCloseTo(31);
    expect(p.area.endsWith('Z')).toBe(true);
  });
});

describe('formats', () => {
  it('écrit les nombres à la française', () => {
    expect(fmt1(18.44)).toBe('18,4');
    expect(signed(4.2, 1)).toBe('+4,2');
    expect(signed(-3)).toBe('−3');
    expect(signed(-0.2)).toBe('+0');
  });

  it('nomme la zone d’après la FTP', () => {
    expect(zoneLabel(215, 260)).toEqual({ id: 'z3', label: 'Z3 · Tempo' });
    expect(zoneLabel(270, 260).id).toBe('z4');
  });
});
