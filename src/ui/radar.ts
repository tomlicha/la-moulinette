import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './home.css';
import { radarTag, type RadarDevice, type RadarRole, type RadarTone } from './radar-model';

/** `mini` : tuile de l'accueil (rôle et nom). `large` : tuile de l'écran Appareils, avec l'état en plus. */
export type RadarVariant = 'mini' | 'large';

export interface Radar {
  update(devices: Record<RadarRole, RadarDevice>): void;
}

export interface RadarOptions {
  /** Si fourni, le médaillon du coureur devient un bouton qui appelle cette fonction. */
  onRider?: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Géométrie commune, dans le repère du dessin : médaillon centré, pastilles sur l'anneau de 68, étiquettes dans les coins (jamais sur le médaillon). */
const GEOMETRY = {
  w: 200, h: 200, rings: [46, 68, 92],
  links: { trainer: [128, 78, 141, 68], hr: [72, 122, 59, 132] },
} as const;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.append(e);
  return e;
};

/**
 * Radar des appareils : le coureur au centre, le trainer et le capteur cardio sur les anneaux, reliés à lui.
 * Chaque bulle donne le rôle (Trainer, Cardio) et, en plus petit, le nom réel de l'appareil.
 * Le navigateur ne donne pas la liste des appareils proches : le radar montre l'état des appareils connus.
 */
export function createRadar(root: HTMLElement, variant: RadarVariant, opts: RadarOptions = {}): Radar {
  const g = GEOMETRY;
  root.replaceChildren();
  const box = el('div', `radar radar--${variant}`, root);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'radar-rings');
  svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
  svg.setAttribute('aria-hidden', 'true');
  const cx = g.w / 2;
  const cy = g.h / 2;
  for (const r of g.rings) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', String(r));
    c.setAttribute('class', 'radar-ring');
    svg.append(c);
  }
  const links = {} as Record<RadarRole, SVGLineElement>;
  for (const role of ['trainer', 'hr'] as const) {
    const [x1, y1, x2, y2] = g.links[role];
    const l = document.createElementNS(SVG_NS, 'line');
    for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) l.setAttribute(k, String(v));
    l.setAttribute('class', 'radar-link');
    svg.append(l);
    links[role] = l;
  }
  box.append(svg);

  el('div', 'radar-sweep', box);
  el('div', 'radar-ping', box);
  const core = el(opts.onRider ? 'button' : 'div', 'radar-core', box);
  if (core instanceof HTMLButtonElement) {
    core.type = 'button';
    core.setAttribute('aria-label', 'Régler mon coureur : masse et FTP');
    core.title = 'Régler mon coureur';
    core.addEventListener('click', opts.onRider!);
  }
  const img = el('img', '', core);
  // Image de repli le temps du rendu (ou si WebGL/WebGPU est indisponible) ; remplacée par le rendu du vrai avatar.
  img.src = `${import.meta.env.BASE_URL}assets/rider-portrait.jpg`;
  img.alt = '';
  img.decoding = 'async';
  void import('../render/rider-portrait')
    .then((m) => m.riderPortrait())
    .then((url) => { if (core.isConnected) img.src = url; })
    .catch((e) => console.warn('portrait du coureur : repli sur l’image statique', e));

  const parts = {} as Record<RadarRole, { dot: HTMLElement; tag: HTMLElement; role: HTMLElement; name: HTMLElement; status: HTMLElement }>;
  for (const role of ['trainer', 'hr'] as const) {
    const dot = el('span', 'radar-dot', box);
    const tag = el('div', 'radar-tag', box);
    const r = el('b', 'r', tag);
    const name = el('span', 'n', tag);
    const status = el('span', 's', tag);
    dot.dataset.role = tag.dataset.role = role;
    parts[role] = { dot, tag, role: r, name, status };
  }

  return {
    update(devices) {
      const summary: string[] = [];
      for (const role of ['trainer', 'hr'] as const) {
        const t = radarTag(role, devices[role]);
        const p = parts[role];
        p.role.textContent = t.role;
        p.name.textContent = t.name;
        p.status.textContent = t.status;
        p.dot.dataset.tone = p.tag.dataset.tone = t.tone;
        links[role].dataset.tone = t.tone;
        summary.push(`${t.role} : ${t.name}, ${t.status.toLowerCase()}`);
      }
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', `Appareils. ${summary.join(' ; ')}.`);
    },
  };
}
