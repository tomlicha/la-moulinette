import {
  BLOCK_LABEL,
  blockDurationS,
  blocksToWorkout,
  defaultBlock,
  toZwo,
  validateBlocks,
  workoutStats,
  workoutToBlocks,
  type BlockType,
  type EditorBlock,
  type WorkoutStats,
} from '../workout/blocks';
import { blockIndexAt, blockRanges, blockShort, describeBlock, nudgeDuration, nudgePower, splitIntervals } from '../workout/block-ops';
import { UndoHistory } from '../workout/history';
import type { WorkoutLibrary } from '../workout/library';
import { targetWatts, type Workout } from '../workout/model';
import { profilePeakW, profileShapes, zoneOf, type Zone } from '../workout/profile';
import { parseWorkout } from '../workout/runner';
import { SAMPLE_WORKOUTS } from '../workout/samples';
import { effortSeconds, intensityWord, timeInZones, ZONES, zoneName, zoneReading, type ZoneTimes } from '../workout/zones';
import { formatDuration, parseDuration } from './duration';

const SVG = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 120;
const POWER_STEP = 0.05;
const DURATION_STEP_S = 15;

interface Draft {
  id?: string;
  name: string;
  description: string;
  blocks: EditorBlock[];
}

export interface EditorOptions {
  library: WorkoutLibrary;
  readFtp: () => number;
  log: (msg: string) => void;
  /** La bibliothèque a changé : la liste des séances de l'écran de sortie doit être reconstruite. */
  onLibraryChange: () => void;
  /** Utiliser une séance enregistrée dans la sortie. */
  onUse: (id: string) => void;
  /** Utiliser une séance d'exemple dans la sortie. */
  onUseSample: (sampleId: string) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seance';

const pct = (fraction: number) => Math.round(fraction * 100);
const fmtLong = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : formatDuration(s));
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, dialog[open]');

/**
 * Écran « Séances » : bibliothèque (mes séances, modèles, import) et éditeur à profil direct.
 * Le profil, la bande de structure et la ligne de réglages montrent le même bloc sélectionné ; chaque
 * modification passe par `commit`, qui l'inscrit dans l'historique avant de redessiner.
 */
export function setupWorkoutEditor(o: EditorOptions) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const editor = $('editor');
  const nameIn = $<HTMLInputElement>('ed-name');
  const descIn = $<HTMLTextAreaElement>('ed-desc');
  const plot = $('ed-plot');
  const tip = $('ed-tip');
  const inspector = $<HTMLFormElement>('ed-inspector');
  const insertDialog = $<HTMLDialogElement>('ed-insert');
  const cadenceDialog = $<HTMLDialogElement>('ed-cadence');
  const history = new UndoHistory<EditorBlock[]>();

  let draft: Draft | undefined;
  let selected = 0;
  /** Version enregistrée (ou ouverte), pour l'indicateur « modifiée » et les écarts du résumé. */
  let baseline = '';
  let baseStats: WorkoutStats | undefined;
  let baseZones: ZoneTimes | undefined;
  /** Saisie clavier en cours dans un champ : une seule entrée d'historique pour toute la frappe. */
  let typing = false;
  let insertAt = 0;

  const ftp = () => o.readFtp();
  const workout = (): Workout => blocksToWorkout(draft?.name ?? '', draft?.description, draft?.blocks ?? []);
  const isDirty = () => !!draft && JSON.stringify(draft) !== baseline;

  // --- Bibliothèque ---

  function summary(blocks: EditorBlock[]) {
    const s = workoutStats(blocksToWorkout('x', undefined, blocks), ftp());
    return `${formatDuration(s.durationS)} · ${s.avgW} W moyens · charge ${s.load}`;
  }

  function button(label: string, onClick: () => void, cls = '') {
    const b = el('button', { textContent: label, type: 'button', className: cls });
    b.addEventListener('click', onClick);
    return b;
  }

  function renderLibrary() {
    const items = o.library.list();
    $('lib-list').replaceChildren(
      ...(items.length
        ? items.map((w) =>
            el(
              'li',
              { className: 'lib-item' },
              el('div', {}, el('strong', { textContent: w.name }), el('span', { className: 'note', textContent: ` · ${summary(w.blocks)}` })),
              el(
                'div',
                { className: 'row' },
                button('Utiliser', () => o.onUse(w.id)),
                button('Modifier', () => open({ id: w.id, name: w.name, description: w.description ?? '', blocks: structuredClone(w.blocks) }), 'secondary'),
                button('Exporter .zwo', () => download(`${slug(w.name)}.zwo`, toZwo(w.name, w.description, w.blocks)), 'secondary'),
                button(
                  'Supprimer',
                  () => {
                    if (!confirm(`Supprimer la séance « ${w.name} » ?`)) return;
                    o.library.remove(w.id);
                    o.log(`séance supprimée : ${w.name}`);
                    if (draft?.id === w.id) close(true);
                    renderLibrary();
                    o.onLibraryChange();
                  },
                  'secondary',
                ),
              ),
            ),
          )
        : [el('li', { className: 'note', textContent: 'Aucune séance enregistrée : crée-en une ou copie un modèle.' })]),
    );
  }

  function renderSamples() {
    $('lib-samples').replaceChildren(
      ...SAMPLE_WORKOUTS.map((s) => {
        const w = parseWorkout(s.fileName, s.text);
        const { blocks } = workoutToBlocks(w, ftp());
        return el(
          'li',
          { className: 'lib-item' },
          el('div', {}, el('strong', { textContent: w.name }), el('span', { className: 'note', textContent: ` · ${summary(blocks)}` })),
          el(
            'div',
            { className: 'row' },
            button('Utiliser', () => o.onUseSample(s.id)),
            button('Copier pour modifier', () => openFromWorkoutFile(s.fileName, s.text, `${w.name} (copie)`), 'secondary'),
          ),
        );
      }),
    );
  }

  function openFromWorkoutFile(fileName: string, text: string, name?: string) {
    let w;
    try {
      w = parseWorkout(fileName, text);
    } catch (e) {
      o.log(`import impossible (${fileName}) : ${e instanceof Error ? e.message : e}`);
      return;
    }
    const { blocks, warnings } = workoutToBlocks(w, ftp());
    for (const m of [...w.warnings, ...warnings]) o.log(`import : ${m}`);
    open({ name: name ?? w.name, description: w.description ?? '', blocks }, true);
  }

  // --- Ouverture, enregistrement ---

  function open(d: Draft, unsaved = false) {
    if (isDirty() && !confirm('Abandonner les modifications en cours ?')) return;
    draft = d;
    selected = Math.min(1, d.blocks.length - 1);
    history.clear();
    // Une séance importée ou nouvelle n'a pas de version enregistrée : elle part « modifiée ».
    baseline = unsaved ? '' : JSON.stringify(d);
    const w = workout();
    baseStats = unsaved ? undefined : workoutStats(w, ftp());
    baseZones = unsaved ? undefined : timeInZones(w, ftp());
    $('ed-title').textContent = d.id ? 'Modifier la séance' : 'Nouvelle séance';
    nameIn.value = d.name;
    descIn.value = d.description;
    editor.hidden = false;
    render();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function close(force = false) {
    if (!force && isDirty() && !confirm('Fermer sans enregistrer les modifications ?')) return;
    draft = undefined;
    baseline = '';
    editor.hidden = true;
  }

  function save(): string | undefined {
    if (!draft || validateBlocks(draft.blocks).length) return undefined;
    try {
      const saved = o.library.save({
        id: draft.id,
        name: draft.name.trim() || 'Séance sans nom',
        description: draft.description.trim() || undefined,
        blocks: draft.blocks,
      });
      draft.id = saved.id;
      baseline = JSON.stringify(draft);
      baseStats = workoutStats(workout(), ftp());
      baseZones = timeInZones(workout(), ftp());
      $('ed-title').textContent = 'Modifier la séance';
      o.log(`séance enregistrée : ${saved.name}`);
      renderLibrary();
      o.onLibraryChange();
      render();
      return saved.id;
    } catch (e) {
      o.log(`enregistrement impossible (stockage du navigateur plein ou bloqué) : ${e instanceof Error ? e.message : e}`);
      return undefined;
    }
  }

  // --- Modifications ---

  /** Applique une modification des blocs en l'inscrivant d'abord dans l'historique. */
  function commit(change: (blocks: EditorBlock[]) => EditorBlock[], nextSelected = selected) {
    if (!draft) return;
    history.record(draft.blocks);
    draft.blocks = change(draft.blocks);
    selected = Math.max(0, Math.min(nextSelected, draft.blocks.length - 1));
    render();
  }

  const updateSelected = (f: (b: EditorBlock) => EditorBlock) =>
    commit((bs) => bs.map((b, i) => (i === selected ? f(b) : b)));

  function insertBlock(type: BlockType, at: number) {
    commit((bs) => [...bs.slice(0, at), defaultBlock(type), ...bs.slice(at)], at);
  }

  function select(i: number) {
    if (!draft?.blocks.length) return;
    selected = Math.max(0, Math.min(i, draft.blocks.length - 1));
    render();
  }

  function undo() {
    if (!draft) return;
    const prev = history.undo(draft.blocks);
    if (!prev) return;
    draft.blocks = prev;
    selected = Math.min(selected, prev.length - 1);
    render();
  }

  function redo() {
    if (!draft) return;
    const next = history.redo(draft.blocks);
    if (!next) return;
    draft.blocks = next;
    selected = Math.min(selected, next.length - 1);
    render();
  }

  // --- Rendu ---

  function render(keepInspector = false) {
    if (!draft) return;
    const w = workout();
    const f = ftp();
    const stats = workoutStats(w, f);
    const zones = timeInZones(w, f);
    $('ed-dirty').hidden = !isDirty();
    $<HTMLButtonElement>('ed-undo').disabled = !history.canUndo;
    $<HTMLButtonElement>('ed-redo').disabled = !history.canRedo;
    const sel = draft.blocks[selected];
    $('ed-linked').textContent = sel?.type === 'intervals' ? `Les ${sel.repeat} répétitions sont modifiées ensemble` : '';
    renderSummary(stats, zones);
    renderChart(w, f);
    renderStrip();
    if (keepInspector) refreshInspectorText();
    else renderInspector();
    renderZones(zones);
    const errors = validateBlocks(draft.blocks);
    $('ed-errors').replaceChildren(...errors.map((e) => el('li', { textContent: e })));
    for (const id of ['ed-save', 'ed-use', 'ed-export']) $<HTMLButtonElement>(id).disabled = errors.length > 0;
  }

  function delta(now: number, before: number | undefined, digits = 0, unit = '') {
    if (before === undefined) return '';
    const d = +(now - before).toFixed(digits);
    if (d === 0) return '';
    return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(digits).replace('.', ',')}${unit}`;
  }

  function renderSummary(s: WorkoutStats, z: ZoneTimes) {
    const f = ftp();
    const cell = (k: string, v: string, h: string, d = '', small = '') =>
      el(
        'div',
        {},
        el('div', { className: 'k', textContent: k }),
        el('div', { className: 'v' }, v, small ? el('small', { textContent: ` ${small}` }) : '', d ? el('span', { className: 'delta', textContent: d }) : ''),
        el('div', { className: 'h', textContent: h }),
      );
    $('ed-summary').replaceChildren(
      cell('Durée', fmtLong(s.durationS), `dont ${fmtLong(effortSeconds(z))} d'effort`, delta(s.durationS / 60, baseStats && baseStats.durationS / 60, 0, ' min')),
      cell('Puissance moyenne', `${s.avgW} W`, `${Math.round((s.avgW / f) * 100)} % de ta FTP (${f} W)`, delta(s.avgW, baseStats?.avgW)),
      cell('Intensité', s.intensity.toFixed(2).replace('.', ','), '1,00 = tenir sa FTP', delta(s.intensity, baseStats?.intensity, 2), intensityWord(s.intensity)),
      cell('Charge estimée', String(s.load), '1 h à la FTP = 100', delta(s.load, baseStats?.load)),
    );
  }

  function renderChart(w: Workout, f: number) {
    const peak = profilePeakW(w, f);
    const y = (watts: number) => H - (watts / peak) * H;
    const top = (watts: number) => `${(1 - watts / peak) * 100}%`;
    const total = w.steps.reduce((t, s) => t + s.durationS, 0) || 1;

    // Axe vertical : % de FTP et watts, FTP en gras.
    const yaxis = $('ed-yaxis');
    yaxis.replaceChildren(
      ...[
        [peak, `${Math.round((peak / f) * 100)} % · ${Math.round(peak)} W`, ''],
        [f, `FTP · ${f} W`, 'ftp'],
        [0.75 * f, `75 % · ${Math.round(0.75 * f)} W`, ''],
        [0.5 * f, `50 % · ${Math.round(0.5 * f)} W`, ''],
        [0, '0', ''],
      ].map(([watts, label, cls]) => {
        const s = el('span', { textContent: label as string, className: cls as string });
        s.style.top = top(watts as number);
        return s;
      }),
    );

    // Bandes de zones, puis paliers, ligne de FTP et cadre du bloc sélectionné.
    const root = $('ed-svg');
    const bands = svg('g', {});
    const labels: HTMLElement[] = [];
    const selZone = selectedZone();
    ZONES.forEach((z, i) => {
      const lo = z.from * f;
      const hi = Math.min(peak, (ZONES[i + 1]?.from ?? Infinity) * f);
      if (lo >= peak) return;
      bands.append(svg('rect', { x: 0, y: y(hi), width: W, height: y(lo) - y(hi), fill: `var(--${z.id})`, 'fill-opacity': 0.1 }));
      const label = el('span', { textContent: z.name, className: z.id === selZone ? 'on' : '' });
      label.style.top = top((lo + hi) / 2);
      labels.push(label);
    });
    $('ed-zone-labels').replaceChildren(...labels);

    const bars = svg('g', { class: 'ed-svg-bars' });
    for (const s of profileShapes(w, f, W, H)) bars.append(svg('path', { d: s.d, class: s.zone }));
    const ftpLine = svg('line', { x1: 0, x2: W, y1: y(f), y2: y(f), stroke: 'currentColor', 'stroke-opacity': 0.55, 'stroke-dasharray': '8 6', 'vector-effect': 'non-scaling-stroke' });
    root.replaceChildren(bands, bars, ftpLine);
    const r = blockRanges(draft!.blocks)[selected];
    if (r) {
      root.append(
        svg('rect', {
          x: (r.start / total) * W,
          y: 0.5,
          width: ((r.end - r.start) / total) * W,
          height: H - 1,
          fill: 'none',
          stroke: 'var(--accent)',
          'stroke-width': 2,
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }
    root.setAttribute('aria-label', `Profil de la séance, ${draft!.blocks.length} blocs, ${fmtLong(total)}`);

    $('ed-xaxis').replaceChildren(...[0, 0.25, 0.5, 0.75, 1].map((k) => el('span', { textContent: fmtLong(Math.round(k * total)) })));
  }

  function selectedZone(): Zone | undefined {
    const b = draft?.blocks[selected];
    if (!b || b.type === 'free') return undefined;
    const main = b.type === 'steady' ? b.power : b.type === 'intervals' ? b.onPower : (b.from + b.to) / 2;
    return zoneOf(main);
  }

  function renderStrip() {
    const blocks = draft!.blocks;
    const items: HTMLElement[] = [];
    const ins = (at: number) => {
      const b = el('button', { type: 'button', className: 'ins', textContent: '+' });
      b.setAttribute('aria-label', at >= blocks.length ? 'Ajouter un bloc à la fin' : `Insérer un bloc avant le bloc ${at + 1}`);
      b.addEventListener('click', () => {
        insertAt = at;
        insertDialog.showModal();
      });
      return b;
    };
    blocks.forEach((b, i) => {
      if (i > 0) items.push(ins(i));
      const btn = el('button', { type: 'button', className: 'blk' }, el('strong', { textContent: BLOCK_LABEL[b.type] }), el('br'), el('small', { textContent: blockShort(b) }));
      btn.style.flex = `${blockDurationS(b)} 1 0`;
      const main = b.type === 'free' ? undefined : b.type === 'steady' ? b.power : b.type === 'intervals' ? b.onPower : (b.from + b.to) / 2;
      btn.style.borderLeftColor = main === undefined ? 'var(--muted)' : `var(--${zoneOf(main)})`;
      btn.setAttribute('aria-pressed', String(i === selected));
      btn.title = `${BLOCK_LABEL[b.type]} · ${blockShort(b)}`;
      btn.addEventListener('click', () => select(i));
      items.push(btn);
    });
    items.push(ins(blocks.length));
    $('ed-strip').replaceChildren(...items);
  }

  // --- Ligne de réglages du bloc sélectionné ---

  /** Champ de puissance en % avec boutons ±5 % ; `key` sert à rendre le focus après redessin. */
  function powerStepper(label: string, value: number, set: (v: number) => void, key: string) {
    const input = el('input', { type: 'number', value: String(pct(value)), min: '1', max: '300', step: '1' });
    input.setAttribute('aria-label', `${label}, en % de la FTP`);
    input.dataset.key = `${key}-in`;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      const ok = input.value.trim() !== '' && v > 0 && v <= 300;
      input.classList.toggle('invalid', !ok);
      if (!ok) return;
      liveEdit(() => set(v / 100));
    });
    const step = (d: number) => {
      const b = el('button', { type: 'button', textContent: d > 0 ? '+' : '−' });
      b.setAttribute('aria-label', `${label} ${d > 0 ? 'plus' : 'moins'} 5 %`);
      b.dataset.key = `${key}-${d > 0 ? 'up' : 'down'}`;
      b.addEventListener('click', () => commitSet(set, Math.min(3, Math.max(0.05, Math.round((value + d) * 100) / 100))));
      return b;
    };
    return el('div', { className: 'stepper' }, step(-POWER_STEP), input, el('span', { textContent: '%' }), step(POWER_STEP));
  }

  /** Les setters écrivent dans le bloc sélectionné du brouillon : on le copie d'abord, l'historique garde l'original. */
  function commitSet(set: (v: number) => void, v: number) {
    if (!draft) return;
    history.record(draft.blocks);
    typing = false;
    draft.blocks = structuredClone(draft.blocks);
    set(v);
    render();
  }

  function durationField(label: string, value: number, set: (v: number) => void, key: string) {
    const input = el('input', { type: 'text', value: formatDuration(value), inputMode: 'numeric', placeholder: 'mm:ss' });
    input.setAttribute('aria-label', label);
    input.dataset.key = key;
    input.addEventListener('input', () => {
      const v = parseDuration(input.value);
      input.classList.toggle('invalid', v === undefined || v < 1);
      if (v === undefined || v < 1) return;
      liveEdit(() => set(v));
    });
    return el('label', { className: 'dur' }, label.split(' ')[0]!.toLowerCase(), input);
  }

  function countStepper(value: number, set: (v: number) => void) {
    const input = el('input', { type: 'number', value: String(value), min: '1', step: '1' });
    input.setAttribute('aria-label', 'Répétitions');
    input.dataset.key = 'rep-in';
    input.addEventListener('input', () => {
      const v = Number(input.value);
      const ok = Number.isInteger(v) && v >= 1 && v <= 50;
      input.classList.toggle('invalid', !ok);
      if (ok) liveEdit(() => set(v));
    });
    const step = (d: number) => {
      const b = el('button', { type: 'button', textContent: d > 0 ? '+' : '−' });
      b.setAttribute('aria-label', d > 0 ? 'Une répétition de plus' : 'Une répétition de moins');
      b.dataset.key = `rep-${d > 0 ? 'up' : 'down'}`;
      b.addEventListener('click', () => updateSelected((x) => (x.type === 'intervals' ? { ...x, repeat: Math.max(1, Math.min(50, x.repeat + d)) } : x)));
      return b;
    };
    return el('div', { className: 'stepper' }, step(-1), input, step(1));
  }

  /** Frappe dans un champ : on modifie le brouillon en place et on redessine tout sauf la ligne de réglages. */
  function liveEdit(apply: () => void) {
    if (!draft) return;
    if (!typing) {
      history.record(draft.blocks);
      typing = true;
    }
    apply();
    render(true);
  }

  /** Légende « Effort · Seuil » ; la zone est omise quand elle répète le nom (« Récupération · Récupération »). */
  const legendText = (name: string, zone?: string) => (zone && zone !== name ? `${name} · ${zone}` : name);

  function fieldset(name: string, zone: string | undefined, main: boolean, ...children: Node[]) {
    const f = el('fieldset', { className: main ? 'main' : '' }, el('legend', { textContent: legendText(name, zone) }), ...children);
    f.dataset.legend = name;
    return f;
  }

  function renderInspector() {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
    const b = draft!.blocks[selected];
    if (!b) {
      inspector.replaceChildren(el('p', { className: 'note', textContent: 'Aucun bloc : ajoute-en un ci-dessous.' }));
      return;
    }
    const f = ftp();
    const cur = () => draft!.blocks[selected]!;
    const set = <K extends string>(k: K) => (v: number) => ((cur() as unknown as Record<K, number>)[k] = v);
    const z = (p: number) => zoneName(zoneOf(p));

    const actions = el('div', { className: 'actions' });
    if (b.type !== 'free') {
      const c = b.cadenceRpm;
      actions.append(button(c ? `Cadence cible : ${c} rpm…` : 'Cadence cible…', openCadence, 'secondary'));
    }
    actions.append(
      button('← Avant', () => moveSelected(-1), 'secondary'),
      button('Après →', () => moveSelected(1), 'secondary'),
      button('Dupliquer', () => commit((bs) => [...bs.slice(0, selected + 1), structuredClone(b), ...bs.slice(selected + 1)], selected + 1), 'secondary'),
    );
    if (b.type === 'intervals') {
      actions.append(button('Séparer les répétitions', () => commit((bs) => [...bs.slice(0, selected), ...splitIntervals(b), ...bs.slice(selected + 1)]), 'secondary'));
    }
    actions.append(button('Supprimer', deleteSelected, 'secondary danger'));
    actions.querySelectorAll('button').forEach((x, i) => (x.dataset.key = `act-${i}`));

    const line = el('div', { className: 'ed-line' });
    switch (b.type) {
      case 'intervals': {
        const schema = el(
          'div',
          { className: 'rep-schema' },
          el('span', { textContent: 'Une répétition' }),
          el('div', { className: 'bars' }),
          el('span', { textContent: `${formatDuration(b.onS)} + ${formatDuration(b.offS)}, × ${b.repeat}` }),
        );
        const bars = schema.querySelector('.bars')!;
        for (const [s, p] of [[b.onS, b.onPower], [b.offS, b.offPower]] as const) {
          const bar = el('span');
          bar.style.flex = String(s);
          bar.style.height = `${Math.min(100, (p / Math.max(b.onPower, b.offPower)) * 100)}%`;
          bar.style.background = `var(--${zoneOf(p)})`;
          bars.append(bar);
        }
        line.append(
          schema,
          fieldset('Répétitions', undefined, false, countStepper(b.repeat, set('repeat'))),
          fieldset('Effort', z(b.onPower), true, powerStepper('Effort', b.onPower, set('onPower'), 'on'), durationField('Durée de l’effort', b.onS, set('onS'), 'on-dur')),
          fieldset('Récupération', z(b.offPower), false, powerStepper('Récupération', b.offPower, set('offPower'), 'off'), durationField('Durée de la récupération', b.offS, set('offS'), 'off-dur')),
        );
        break;
      }
      case 'steady':
        line.append(fieldset('Puissance', z(b.power), true, powerStepper('Puissance', b.power, set('power'), 'p'), durationField('Durée du palier', b.durationS, set('durationS'), 'dur')));
        break;
      case 'warmup':
      case 'cooldown':
      case 'ramp':
        line.append(
          fieldset('Début', z(b.from), true, powerStepper('Début', b.from, set('from'), 'from'), durationField('Durée du bloc', b.durationS, set('durationS'), 'dur')),
          fieldset('Fin', z(b.to), false, powerStepper('Fin', b.to, set('to'), 'to')),
        );
        break;
      case 'free':
        line.append(fieldset('Libre', 'sans consigne', true, durationField('Durée du bloc', b.durationS, set('durationS'), 'dur')));
        break;
    }

    inspector.replaceChildren(el('div', { className: 'top' }, el('p', { className: 'sentence', textContent: describeBlock(b, f) }), actions), line);
    if (active) inspector.querySelector<HTMLElement>(`[data-key="${active}"]`)?.focus();
  }

  /** Pendant la frappe : la phrase et les zones des légendes suivent, sans reconstruire les champs. */
  function refreshInspectorText() {
    const b = draft!.blocks[selected];
    if (!b) return;
    const sentence = inspector.querySelector('.sentence');
    if (sentence) sentence.textContent = describeBlock(b, ftp());
    const z = (p: number) => zoneName(zoneOf(p));
    const legends: Record<string, string | undefined> = {
      Effort: b.type === 'intervals' ? z(b.onPower) : undefined,
      Récupération: b.type === 'intervals' ? z(b.offPower) : undefined,
      Puissance: b.type === 'steady' ? z(b.power) : undefined,
      Début: 'from' in b ? z(b.from) : undefined,
      Fin: 'to' in b ? z(b.to) : undefined,
    };
    inspector.querySelectorAll<HTMLFieldSetElement>('fieldset[data-legend]').forEach((fs) => {
      const zone = legends[fs.dataset.legend!];
      if (zone) fs.querySelector('legend')!.textContent = legendText(fs.dataset.legend!, zone);
    });
  }

  function moveSelected(d: number) {
    const j = selected + d;
    if (!draft || j < 0 || j >= draft.blocks.length) return;
    commit((bs) => {
      const c = [...bs];
      [c[selected], c[j]] = [c[j]!, c[selected]!];
      return c;
    }, j);
  }

  function deleteSelected() {
    if (!draft?.blocks.length) return;
    commit((bs) => bs.filter((_, i) => i !== selected), selected);
  }

  // --- Temps par zone ---

  function renderZones(z: ZoneTimes) {
    const total = Object.values(z).reduce((a, b) => a + b, 0) || 1;
    const ids = [...ZONES.map((x) => x.id), 'free'] as Zone[];
    const bar = el('div', { className: 'zone-bar' });
    bar.setAttribute('aria-hidden', 'true');
    for (const id of ids) {
      if (!z[id]) continue;
      const s = el('span');
      s.style.width = `${(z[id] / total) * 100}%`;
      s.style.background = id === 'free' ? 'var(--muted)' : `var(--${id})`;
      bar.append(s);
    }
    const rows = ids
      .filter((id) => z[id] || baseZones?.[id])
      .sort((a, b) => z[b] - z[a])
      .map((id) => {
        const was = baseZones && baseZones[id] !== z[id] ? el('span', { className: 'was', textContent: ` (avant : ${formatDuration(baseZones[id])})` }) : '';
        return el('li', {}, el('span', { textContent: zoneName(id) }), el('span', {}, el('strong', { textContent: formatDuration(z[id]) }), was));
      });
    $('ed-zones').replaceChildren(
      el('h3', { textContent: 'Temps par zone' }),
      bar,
      el('ul', {}, ...rows),
      el('p', { className: 'note', textContent: zoneReading(z, formatDuration) }),
    );
  }

  // --- Info-bulle et sélection sur le profil ---

  function timeAt(e: MouseEvent): number {
    const r = plot.getBoundingClientRect();
    const total = workout().steps.reduce((t, s) => t + s.durationS, 0);
    return Math.max(0, Math.min(total - 0.001, ((e.clientX - r.left) / r.width) * total));
  }

  plot.addEventListener('mousemove', (e) => {
    if (!draft?.blocks.length) return;
    const t = timeAt(e);
    const bi = blockIndexAt(draft.blocks, t);
    const b = draft.blocks[bi]!;
    const range = blockRanges(draft.blocks)[bi]!;
    const w = workout();
    let acc = 0;
    let stepLeft = 0;
    let watts: number | undefined;
    for (const s of w.steps) {
      if (t < acc + s.durationS) {
        watts = targetWatts(s, t - acc, ftp());
        stepLeft = acc + s.durationS - t;
        break;
      }
      acc += s.durationS;
    }
    let what: string = BLOCK_LABEL[b.type];
    if (b.type === 'intervals') {
      const inRep = t - range.start;
      const rep = Math.floor(inRep / (b.onS + b.offS)) + 1;
      what = `${inRep % (b.onS + b.offS) < b.onS ? 'effort' : 'récupération'} ${rep} sur ${b.repeat}`;
    }
    const f = ftp();
    tip.replaceChildren(
      el('strong', { textContent: formatDuration(Math.floor(t)) }),
      ` · ${what}`,
      el('br'),
      watts === undefined ? 'sans consigne' : `${watts} W · ${Math.round((watts / f) * 100)} % · ${zoneName(zoneOf(watts / f))}`,
      el('br'),
      el('span', { className: 'muted', textContent: `encore ${formatDuration(Math.ceil(stepLeft))} dans ce palier` }),
    );
    tip.hidden = false;
    const r = plot.getBoundingClientRect();
    const x = e.clientX - r.left;
    tip.style.left = x > r.width * 0.6 ? '' : `${x + 12}px`;
    tip.style.right = x > r.width * 0.6 ? `${r.width - x + 12}px` : '';
  });
  plot.addEventListener('mouseleave', () => (tip.hidden = true));
  plot.addEventListener('click', (e) => {
    if (draft?.blocks.length) select(blockIndexAt(draft.blocks, timeAt(e)));
  });

  // --- Clavier ---

  document.addEventListener('keydown', (e) => {
    if (!draft || editor.hidden || editor.offsetParent === null || isTyping(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (ctrl || e.altKey) return;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        updateSelected((b) => nudgePower(b, e.key === 'ArrowUp' ? POWER_STEP : -POWER_STEP));
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const d = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey) updateSelected((b) => nudgeDuration(b, d * DURATION_STEP_S));
        else select(selected + d);
        break;
      }
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        deleteSelected();
        break;
    }
  });

  // --- Cadence cible (option, hors de la ligne de réglages) ---

  function openCadence() {
    const b = draft?.blocks[selected];
    if (!b || b.type === 'free') return;
    $('ed-cad-on-label').textContent = b.type === 'intervals' ? 'Effort' : 'Cadence';
    $<HTMLInputElement>('ed-cad-on').value = b.cadenceRpm ? String(b.cadenceRpm) : '';
    $('ed-cad-off-row').hidden = b.type !== 'intervals';
    $<HTMLInputElement>('ed-cad-off').value = b.type === 'intervals' && b.restCadenceRpm ? String(b.restCadenceRpm) : '';
    cadenceDialog.showModal();
  }

  const readRpm = (id: string) => {
    const v = Math.round(Number($<HTMLInputElement>(id).value));
    return v >= 30 && v <= 200 ? v : undefined;
  };
  const withCadence = (b: EditorBlock, on?: number, off?: number): EditorBlock => {
    if (b.type === 'free') return b;
    const c = { ...b } as EditorBlock & { cadenceRpm?: number; restCadenceRpm?: number };
    if (on) c.cadenceRpm = on;
    else delete c.cadenceRpm;
    if (c.type === 'intervals') {
      if (off) c.restCadenceRpm = off;
      else delete c.restCadenceRpm;
    }
    return c;
  };
  $('ed-cad-apply').addEventListener('click', () => {
    updateSelected((b) => withCadence(b, readRpm('ed-cad-on'), readRpm('ed-cad-off')));
    cadenceDialog.close();
  });
  $('ed-cad-clear').addEventListener('click', () => {
    updateSelected((b) => withCadence(b));
    cadenceDialog.close();
  });

  // --- Insertion à un endroit précis ---

  $('ed-insert-types').replaceChildren(
    ...(['warmup', 'steady', 'intervals', 'ramp', 'free', 'cooldown'] as BlockType[]).map((t) =>
      button(BLOCK_LABEL[t], () => {
        insertDialog.close();
        insertBlock(t, insertAt);
      }, 'chip'),
    ),
  );
  for (const d of [insertDialog, cadenceDialog]) {
    d.querySelector('[data-close]')?.addEventListener('click', () => d.close());
  }

  // --- Branchements ---

  nameIn.addEventListener('input', () => {
    if (!draft) return;
    draft.name = nameIn.value;
    $('ed-dirty').hidden = !isDirty();
  });
  descIn.addEventListener('input', () => {
    if (!draft) return;
    draft.description = descIn.value;
    $('ed-dirty').hidden = !isDirty();
  });
  // Fin d'une frappe : la prochaine saisie ouvrira une nouvelle entrée d'historique, et les champs reprennent leur forme normale.
  inspector.addEventListener('focusout', () => {
    if (!typing) return;
    typing = false;
    setTimeout(() => {
      if (!inspector.contains(document.activeElement)) render();
    });
  });
  inspector.addEventListener('submit', (e) => e.preventDefault());

  document.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!draft) return;
      // Ajouté après le bloc sélectionné : c'est là que l'utilisateur regarde.
      insertBlock(b.dataset.add as BlockType, draft.blocks.length ? selected + 1 : 0);
    }),
  );
  $('ed-undo').addEventListener('click', undo);
  $('ed-redo').addEventListener('click', redo);
  $('lib-new').addEventListener('click', () =>
    open({ name: 'Nouvelle séance', description: '', blocks: [defaultBlock('warmup'), defaultBlock('intervals'), defaultBlock('cooldown')] }, true),
  );
  const importIn = $<HTMLInputElement>('lib-import');
  importIn.addEventListener('change', async () => {
    const f = importIn.files?.[0];
    if (f) openFromWorkoutFile(f.name, await f.text());
    importIn.value = '';
  });
  $('ed-save').addEventListener('click', () => void save());
  $('ed-use').addEventListener('click', () => {
    const id = save();
    if (id) o.onUse(id);
  });
  $('ed-export').addEventListener('click', () => {
    if (draft) download(`${slug(draft.name)}.zwo`, toZwo(draft.name, draft.description, draft.blocks));
  });
  $('ed-close').addEventListener('click', () => close());
  addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault();
  });

  renderLibrary();
  renderSamples();

  return {
    /** À appeler quand la FTP change : les watts affichés en dépendent. */
    refresh() {
      renderLibrary();
      renderSamples();
      if (draft) render();
    },
  };
}
