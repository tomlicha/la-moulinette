import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './hud.css';
import type { Route } from '../sim/route';
import type { RideSnapshot } from '../sim/ride';
import { STEP_LABEL, type Workout } from '../workout/model';
import { profileShapes } from '../workout/profile';
import type { WorkoutState } from '../workout/runner';
import { ZONES } from '../workout/zones';
import { formatDuration } from './duration';
import {
  findSeries,
  fmt1,
  nextSummitM,
  repetitionAt,
  routeProfile,
  signed,
  upcoming,
  zoneLabel,
  type Series,
  type UpcomingStep,
} from './hud-model';

/** Tout ce que le HUD affiche ; une valeur absente s'affiche « – ». */
export interface HudInput {
  /** Puissance moyenne sur 3 s. */
  powerW?: number;
  heartRateBpm?: number;
  cadenceRpm?: number;
  speedKmh?: number;
  ftpW: number;
  ride?: { snapshot: RideSnapshot; climbM: number };
  /** `intensity` : multiplicateur des consignes en cours (1 = séance telle quelle). */
  workout?: { workout: Workout; state: WorkoutState; ftpW: number; intensity?: number };
  /** Message de la séance en cours (consigne du fichier), s'il y en a un à cet instant. */
  message?: string;
  /** Mode de résistance du trainer, s'il est piloté. */
  control?: 'erg' | 'sim';
  trainerConnected: boolean;
  heartRateConnected: boolean;
}

/** Repère de mise en page du HUD : tout est placé en pixels de cette scène, puis mis à l'échelle de la vue. */
const REF_W = 1280;
const REF_H = 720;
/** Bout de la barre de zones, en fraction de FTP. */
const ZBAR_MAX = 1.5;
/** Plage cible affichée autour de la consigne ERG. */
const TARGET_BAND = 0.05;
const ROUTE_W = 744;
const ROUTE_H = 34;
const WO_W = 1112;
/** Bout de l'échelle des blocs de puissance de la liste « À suivre », en fraction de FTP. */
const UP_MAX = 1.5;
const WO_H = 42;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Gabarit statique : aucune donnée de l'utilisateur ici (nom de séance compris), tout passe ensuite par textContent.
const TEMPLATE = `
<div class="hud-stage">
  <section class="hud-p hud-left">
    <div class="col" style="gap:6px" data-when="ride">
      <div class="title" data-h="routeName"></div>
      <div class="lab" style="margin-bottom:4px">Sortie libre</div>
      <div class="row"><span class="lab">Temps</span><span class="n" style="font-size:26px" data-h="time">–</span></div>
      <div class="row"><span class="lab">Distance</span><span class="n" style="font-size:26px"><span data-h="dist">–</span> <span class="u">km</span></span></div>
      <div class="row"><span class="lab">Dénivelé</span><span class="n" style="font-size:26px"><span data-h="climb">–</span> <span class="u">m</span></span></div>
    </div>
    <div class="col" style="gap:6px" data-when="workout">
      <div class="lab" data-h="stepName">–</div>
      <div style="display:flex; align-items:baseline; gap:8px"><span class="n" style="font-size:64px; font-weight:700" data-h="stepLeft">–</span><span class="lab">restant</span></div>
      <div class="hud-prog"><i class="hud-fill" data-h="stepProg"></i></div>
      <div class="row lab"><span data-h="stepDone">–</span><span data-h="stepCadence"></span></div>
      <div class="hud-next" aria-label="Paliers à venir">
        <div class="hud-next-head"><span data-h="upTitle"></span><span data-h="upInfo"></span></div>
        <div class="hud-next-list" data-h="upList"></div>
      </div>
    </div>
  </section>

  <section class="hud-p hud-center">
    <div class="hud-power">
      <div class="col hud-power-main">
        <span class="lab">Puissance 3 s</span>
        <span style="display:flex; align-items:baseline; gap:4px"><span class="n" data-h="power">–</span><span class="unit">W</span></span>
      </div>
      <div class="divider"></div>
      <div class="hud-metrics">
        <div class="col" data-when="workout"><span class="lab">Cible</span><span class="n hud-zfg" style="font-weight:700" data-h="target">–</span><span class="u" data-h="targetUnit">W</span></div>
        <div class="col"><span class="lab">FC</span><span class="n" data-h="hr">–</span><span class="u">bpm</span></div>
        <div class="col"><span class="lab">Cadence</span><span class="n" data-h="cad">–</span><span class="u">rpm</span></div>
        <div class="col" data-when="not-workout"><span class="lab">Vitesse</span><span class="n" data-h="speed">–</span><span class="u">km/h</span></div>
      </div>
    </div>
    <div class="hud-zbar" data-h="zbar"></div>
    <div class="row lab" data-when="not-workout"><span class="hud-pill" data-h="zone">–</span><span><span data-h="pctFtp">–</span> % de la FTP</span></div>
    <div class="row lab" data-when="workout">
      <span style="display:flex; align-items:center; gap:10px"><span class="hud-pill" data-h="woZone">–</span><span class="hud-chip" data-h="woChip">ERG</span><span>écart <span data-h="delta">–</span> W</span></span>
      <span data-h="range"></span>
    </div>
  </section>

  <section class="hud-p hud-bottom">
    <div data-when="ride" style="display:flex; align-items:center; gap:24px">
      <div class="col" style="width:120px; flex:none">
        <span class="lab">Pente</span>
        <span class="n" style="font-size:40px; font-weight:700"><span data-h="grade">–</span> %</span>
      </div>
      <div class="col" style="gap:4px; width:${ROUTE_W}px; flex:none">
        <div class="row lab"><span data-h="routeInfo"></span><span style="color:var(--hud-fg); font-weight:600" data-h="summit"></span></div>
        <svg data-h="routeSvg" width="${ROUTE_W}" height="${ROUTE_H}" viewBox="0 0 ${ROUTE_W} ${ROUTE_H}" aria-hidden="true"></svg>
      </div>
      <div class="col" style="gap:6px; align-items:flex-end; flex:1; min-width:0">
        <span class="hud-chip" data-h="control"></span>
        <span class="hud-dots"><span><b data-h="dotTrainer">●</b> Home trainer</span><span><b data-h="dotHr">●</b> Cardio</span></span>
      </div>
    </div>
    <div data-when="workout" class="col" style="gap:6px">
      <div class="row">
        <span style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:420px" data-h="woName"></span>
        <span class="lab" data-h="woTime"></span>
        <span class="lab" style="white-space:nowrap">fin dans <span style="color:var(--hud-fg); font-weight:600" data-h="woLeft"></span></span>
      </div>
      <svg data-h="woSvg" width="${WO_W}" height="${WO_H}" viewBox="0 0 ${WO_W} ${WO_H}" role="img" aria-label="Profil de la séance"></svg>
    </div>
  </section>

  <section class="hud-p hud-message" data-h="message" role="status" hidden></section>
</div>`;

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent?.append(n);
  return n;
};
const fmtTime = (s: number) => formatDuration(Math.floor(s));

const hEl = (tag: string, cls: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** Une ligne de la liste « À suivre » : bloc de la couleur de zone, long comme l'intensité, puis la durée. */
function upRow(s: UpcomingStep, ftpW: number, cls: string) {
  const free = s.fromW === undefined || s.toW === undefined;
  const ramp = !free && s.fromW !== s.toW;
  const row = hEl('div', ['hud-up', cls, ramp ? 'ramp' : '', free ? 'free' : ''].filter(Boolean).join(' '));
  row.dataset.z = s.zoneFrom;
  if (ramp) {
    row.style.setProperty('--z-from', `var(--h${s.zoneFrom})`);
    row.style.setProperty('--z-to', `var(--h${s.zoneTo})`);
  }
  const frac = free ? 0 : Math.min(1, Math.max(s.fromW!, s.toW!) / (ftpW * UP_MAX));
  const pw = hEl('span', 'hud-up-pw', free ? 'libre' : ramp ? `${s.fromW}→${s.toW}` : String(s.fromW));
  if (!free && !ramp) pw.append(hEl('small', '', 'W'));
  pw.style.width = `calc(66px + (100% - 66px) * ${frac.toFixed(3)})`;
  const track = hEl('span', 'hud-up-track');
  track.append(pw);
  row.append(track, hEl('span', 'hud-up-dur', s.durationS < 60 ? `${s.durationS} s` : fmtTime(s.durationS)));
  return row;
}

/**
 * HUD de la sortie (docs/design/hud.md) : parcours ou palier à gauche, puissance et mesures du cycliste au centre,
 * profil du parcours ou de la séance en bas. Ne fait qu'afficher : l'état vient de `update`.
 */
export class RideHud {
  private readonly nodes = new Map<string, HTMLElement | SVGElement>();
  private readonly mark: HTMLElement;
  private readonly band: HTMLElement;
  private readonly route: {
    x: (d: number) => number;
    y: (alt: number) => number;
    clip: SVGRectElement;
    summit: SVGLineElement;
    cursor: SVGLineElement;
    dot: SVGCircleElement;
  };
  private wo?: { key: string; shapes: SVGPathElement[]; cursor: SVGLineElement };
  private series?: { workout: Workout; list: Series[] };
  private upKey = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly routeDef: Route,
    opts: { flat?: boolean } = {},
  ) {
    root.classList.add('hud');
    root.classList.toggle('flat', !!opts.flat);
    root.dataset.mode = 'ride';
    root.innerHTML = TEMPLATE;
    root.querySelectorAll<HTMLElement>('[data-h]').forEach((n) => this.nodes.set(n.dataset.h!, n));

    this.text('routeName', `${routeDef.name} · boucle de ${fmt1(routeDef.lengthM / 1000).replace(',0', '')} km`);
    this.text('routeInfo', `${routeDef.name} · ${fmt1(routeDef.lengthM / 1000).replace(',0', '')} km en boucle`);

    // Barre de zones : un segment par zone, largeur proportionnelle à sa plage de FTP.
    const zbar = this.node('zbar');
    const segs = document.createElement('div');
    segs.className = 'segs';
    ZONES.forEach((z, i) => {
      const hi = Math.min(ZONES[i + 1]?.from ?? ZBAR_MAX, ZBAR_MAX);
      const s = document.createElement('span');
      s.style.flex = `${hi - z.from} 0 0`;
      s.style.background = `var(--h${z.id})`;
      segs.append(s);
    });
    this.band = Object.assign(document.createElement('div'), { className: 'band' });
    this.band.dataset.when = 'workout';
    this.mark = Object.assign(document.createElement('div'), { className: 'mark' });
    zbar.append(segs, this.band, this.mark);

    // Profil du parcours, dessiné une fois ; seule la position avance.
    const svg = this.node('routeSvg');
    const p = routeProfile(routeDef, ROUTE_W, ROUTE_H);
    const clipId = `hud-route-${Math.random().toString(36).slice(2, 8)}`;
    const clip = svgEl('rect', { x: 0, y: 0, width: 0, height: ROUTE_H }, svgEl('clipPath', { id: clipId }, svgEl('defs', {}, svg)));
    svgEl('path', { d: p.area, class: 'relief' }, svg);
    svgEl('path', { d: p.area, class: 'relief-done', 'clip-path': `url(#${clipId})` }, svg);
    svgEl('path', { d: p.line, class: 'relief-line' }, svg);
    this.route = {
      x: p.x,
      y: p.y,
      clip,
      summit: svgEl('line', { y1: 0, y2: ROUTE_H, class: 'summit' }, svg),
      cursor: svgEl('line', { y1: 0, y2: ROUTE_H, class: 'cursor' }, svg),
      dot: svgEl('circle', { r: 5, class: 'dot' }, svg),
    };

    // Le HUD est mis en page dans une scène de 1280 × 720 : on l'ajuste à la fenêtre (le plus grand 16:9 qui y tient) et on la centre.
    const fit = () => {
      const w = root.clientWidth;
      const h = root.clientHeight;
      const s = Math.min(w / REF_W, h / REF_H);
      root.style.setProperty('--hud-s', String(s));
      root.style.setProperty('--hud-x', `${(w - REF_W * s) / 2}px`);
      root.style.setProperty('--hud-y', `${(h - REF_H * s) / 2}px`);
    };
    new ResizeObserver(fit).observe(root);
    fit();
  }

  update(i: HudInput) {
    // Avant le départ, la mise en page de la sortie libre s'affiche déjà, valeurs en « – » : le HUD ne saute pas au démarrage.
    const mode = i.workout ? 'workout' : 'ride';
    if (this.root.dataset.mode !== mode) this.root.dataset.mode = mode;

    // Centre : puissance et mesures du cycliste.
    const p = i.powerW;
    this.text('power', p === undefined ? '–' : String(p));
    this.text('hr', i.heartRateBpm === undefined ? '–' : String(Math.round(i.heartRateBpm)));
    this.text('cad', i.cadenceRpm === undefined ? '–' : String(Math.round(i.cadenceRpm)));
    this.text('speed', i.speedKmh === undefined ? '–' : fmt1(i.speedKmh));
    const live = p === undefined ? undefined : zoneLabel(p, i.ftpW);
    this.zone('zone', live?.id ?? '', live?.label ?? '–');
    this.text('pctFtp', p === undefined ? '–' : String(Math.round((p / i.ftpW) * 100)));
    this.mark.style.left = this.pct(p ?? 0, i.ftpW);

    // Gauche et bas : sortie libre.
    if (!i.ride && !i.workout) this.resetRide();
    if (i.ride && !i.workout) {
      const s = i.ride.snapshot;
      this.text('time', fmtTime(s.elapsedS));
      this.text('dist', fmt1(s.distanceM / 1000));
      this.text('climb', `+${Math.round(i.ride.climbM)}`);
      this.text('grade', signed(s.gradePct, 1));
      const toSummit = nextSummitM(this.routeDef, s.distanceM);
      this.text('summit', toSummit === undefined ? '' : `sommet dans ${fmt1(toSummit / 1000)} km`);
      const pos = s.distanceM % this.routeDef.lengthM;
      const x = this.route.x(pos);
      this.route.clip.setAttribute('width', String(x));
      this.line(this.route.cursor, x);
      this.route.dot.setAttribute('cx', String(x));
      this.route.dot.setAttribute('cy', String(this.route.y(this.routeDef.altitudeAt(s.distanceM))));
      if (toSummit === undefined) this.route.summit.style.display = 'none';
      else this.line(this.route.summit, this.route.x((s.distanceM + toSummit) % this.routeDef.lengthM));
    }
    this.text('message', i.workout ? (i.message ?? '') : '');
    this.node('message').hidden = !i.workout || !i.message;
    this.text('control', i.control === 'erg' ? 'ERG' : i.control === 'sim' ? 'SIM' : '');
    this.node('control').hidden = !i.control;
    this.node('dotTrainer').classList.toggle('on', i.trainerConnected);
    this.node('dotHr').classList.toggle('on', i.heartRateConnected);

    // Gauche, centre et bas : séance.
    if (i.workout) this.updateWorkout(i.workout, p);
  }

  /** Sortie pas encore démarrée : tirets et position au départ du parcours. */
  private resetRide() {
    for (const k of ['time', 'dist', 'climb', 'grade']) this.text(k, '–');
    const toSummit = nextSummitM(this.routeDef, 0);
    this.text('summit', toSummit === undefined ? '' : `sommet dans ${fmt1(toSummit / 1000)} km`);
    this.route.clip.setAttribute('width', '0');
    this.line(this.route.cursor, 0);
    this.route.dot.setAttribute('cx', '0');
    this.route.dot.setAttribute('cy', String(this.route.y(this.routeDef.altitudeAt(0))));
    if (toSummit === undefined) this.route.summit.style.display = 'none';
    else this.line(this.route.summit, this.route.x(toSummit));
  }

  private updateWorkout({ workout, state: s, ftpW, intensity = 1 }: NonNullable<HudInput['workout']>, p: number | undefined) {
    const free = s.targetW === undefined;
    const fresh = this.series?.workout !== workout;
    if (fresh) this.series = { workout, list: findSeries(workout.steps) };
    const r = repetitionAt(this.series!.list, s.stepIndex);
    this.text(
      'stepName',
      r ? `${STEP_LABEL[s.step.kind]} · rép. ${r.rep} / ${r.reps}` : `${STEP_LABEL[s.step.kind]} · ${s.stepIndex + 1} / ${workout.steps.length}`,
    );
    this.text('stepLeft', fmtTime(s.stepRemainingS));
    this.text('stepDone', `${fmtTime(s.stepElapsedS)} / ${fmtTime(s.step.durationS)}`);
    this.text('stepCadence', s.step.cadenceRpm ? `cadence ${s.step.cadenceRpm}` : '');
    const z = zoneLabel(s.targetW ?? p ?? 0, ftpW);
    const prog = this.node('stepProg');
    prog.style.width = `${Math.min(100, (s.stepElapsedS / (s.step.durationS || 1)) * 100)}%`;
    prog.dataset.z = z.id;

    this.text('target', free ? 'libre' : String(s.targetW));
    this.node('targetUnit').hidden = free;
    this.node('target').dataset.z = free ? '' : z.id;
    this.zone('woZone', free && p === undefined ? '' : z.id, free && p === undefined ? '–' : z.label);
    this.text('delta', free || p === undefined ? '–' : signed(p - s.targetW!));
    this.text('range', free ? 'palier libre' : `plage ${Math.round(s.targetW! * (1 - TARGET_BAND))}–${Math.round(s.targetW! * (1 + TARGET_BAND))} W`);
    this.node('woChip').hidden = free;
    this.band.hidden = free;
    if (!free) {
      this.band.style.left = this.pct(s.targetW! * (1 - TARGET_BAND), ftpW);
      this.band.style.width = `${((s.targetW! * 2 * TARGET_BAND) / (ftpW * ZBAR_MAX)) * 100}%`;
    }

    this.text('woName', workout.name);
    this.text('woTime', `${fmtTime(s.elapsedS)} / ${fmtTime(s.totalS)}`);
    this.text('woLeft', fmtTime(s.totalS - s.elapsedS));
    this.drawUpcoming(s, ftpW, intensity, fresh);
    this.drawWorkout(workout, ftpW);
    const x = (s.elapsedS / (s.totalS || 1)) * WO_W;
    this.line(this.wo!.cursor, x);
    this.wo!.shapes.forEach((sh, k) => sh.classList.toggle('past', k < s.stepIndex));
  }

  /** Liste « À suivre » : reconstruite au changement de palier (elle glisse alors vers le haut), sinon seul l'en-tête bouge. */
  private drawUpcoming(s: WorkoutState, ftpW: number, intensity: number, fresh: boolean) {
    const { workout, list: series } = this.series!;
    const { items, rest } = upcoming(workout.steps, series, s.stepIndex, ftpW, intensity);
    this.text('upTitle', items.length ? 'À suivre' : 'Dernier palier');
    this.text('upInfo', `${rest > 0 ? `+ ${rest} · ` : ''}fin dans ${fmtTime(s.totalS - s.elapsedS)}`);
    const key = `${s.stepIndex}|${ftpW}|${intensity}`;
    if (!fresh && key === this.upKey) return;
    const animate = !fresh && this.upKey.split('|')[0] !== String(s.stepIndex);
    this.upKey = key;
    const list = this.node('upList');
    list.replaceChildren(
      ...items.map((it, k) => {
        const cls = `f${k + 1}`;
        if (it.kind === 'step') return upRow(it.step, ftpW, k === 0 ? `${cls} first` : cls);
        const g = hEl('div', `hud-up-grp ${cls}`);
        const rows = hEl('div', 'hud-up-rows');
        rows.append(...it.steps.map((x, i) => upRow(x, ftpW, it.nextIs === i ? 'first' : '')));
        const n = hEl('div', 'hud-up-x');
        n.setAttribute('aria-label', `Répétition ${it.rep} sur ${it.reps}`);
        const b = hEl('b', '', String(it.rep));
        b.append(hEl('i', '', `/${it.reps}`));
        n.append(hEl('small', '', 'rép.'), b);
        g.append(rows, n);
        return g;
      }),
    );
    if (animate) {
      list.classList.remove('enter');
      void list.offsetWidth; // relance l'animation
      list.classList.add('enter');
    }
  }

  /** Redessine le profil de séance quand la séance ou la FTP change. */
  private drawWorkout(workout: Workout, ftpW: number) {
    const key = `${workout.name}|${workout.steps.length}|${ftpW}`;
    if (this.wo?.key === key) return;
    const svg = this.node('woSvg');
    svg.replaceChildren();
    const shapes = profileShapes(workout, ftpW, WO_W, WO_H).map((s) => svgEl('path', { d: s.d, class: s.zone }, svg));
    this.wo = { key, shapes, cursor: svgEl('line', { y1: -2, y2: WO_H, class: 'wo-cursor' }, svg) };
  }

  private node<T extends HTMLElement | SVGElement = HTMLElement>(k: string): T {
    return this.nodes.get(k) as T;
  }

  private text(k: string, v: string) {
    const n = this.nodes.get(k);
    if (n && n.textContent !== v) n.textContent = v;
  }

  private zone(k: string, id: string, label: string) {
    this.text(k, label);
    this.node(k).dataset.z = id;
  }

  private pct(w: number, ftpW: number) {
    return `${Math.min(1, Math.max(0, w / (ftpW * ZBAR_MAX))) * 100}%`;
  }

  private line(l: SVGLineElement, x: number) {
    l.style.display = '';
    l.setAttribute('x1', String(x));
    l.setAttribute('x2', String(x));
  }
}
