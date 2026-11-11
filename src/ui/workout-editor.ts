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
} from '../workout/blocks';
import type { WorkoutLibrary } from '../workout/library';
import { profileShapes } from '../workout/profile';
import { parseWorkout } from '../workout/runner';
import { SAMPLE_WORKOUTS } from '../workout/samples';
import { formatDuration, parseDuration } from './duration';

const SVG = 'http://www.w3.org/2000/svg';
const PROFILE_W = 1000;
const PROFILE_H = 120;

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

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
  const a = el('a', { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seance';

const pct = (fraction: number) => Math.round(fraction * 100);

/** Écran « Séances » : bibliothèque (mes séances, modèles, import) et éditeur par blocs avec aperçu du profil. */
export function setupWorkoutEditor(o: EditorOptions) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const libList = $('lib-list');
  const samplesList = $('lib-samples');
  const editor = $('editor');
  const blocksEl = $<HTMLOListElement>('ed-blocks');
  const nameIn = $<HTMLInputElement>('ed-name');
  const descIn = $<HTMLTextAreaElement>('ed-desc');
  const errorsEl = $('ed-errors');
  let draft: Draft | undefined;
  let dirty = false;

  // --- Bibliothèque ---

  function summary(blocks: EditorBlock[]) {
    const s = workoutStats(blocksToWorkout('x', undefined, blocks), o.readFtp());
    return `${formatDuration(s.durationS)} · ${s.avgW} W moyens · charge ${s.load}`;
  }

  function renderLibrary() {
    const items = o.library.list();
    libList.replaceChildren(
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
                button('Modifier', () => open({ id: w.id, name: w.name, description: w.description ?? '', blocks: structuredClone(w.blocks) }), true),
                button('Exporter .zwo', () => download(`${slug(w.name)}.zwo`, toZwo(w.name, w.description, w.blocks)), true),
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
                  true,
                ),
              ),
            ),
          )
        : [el('li', { className: 'note', textContent: 'Aucune séance enregistrée : crée-en une ou copie un modèle.' })]),
    );
  }

  function renderSamples() {
    samplesList.replaceChildren(
      ...SAMPLE_WORKOUTS.map((s) => {
        const w = parseWorkout(s.fileName, s.text);
        const { blocks } = workoutToBlocks(w, o.readFtp());
        return el(
          'li',
          { className: 'lib-item' },
          el('div', {}, el('strong', { textContent: w.name }), el('span', { className: 'note', textContent: ` · ${summary(blocks)}` })),
          el(
            'div',
            { className: 'row' },
            button('Utiliser', () => o.onUseSample(s.id)),
            button('Copier pour modifier', () => openFromWorkoutFile(s.fileName, s.text, `${w.name} (copie)`), true),
          ),
        );
      }),
    );
  }

  function button(label: string, onClick: () => void, secondary = false) {
    const b = el('button', { textContent: label, type: 'button' });
    if (secondary) b.className = 'secondary';
    b.addEventListener('click', onClick);
    return b;
  }

  function openFromWorkoutFile(fileName: string, text: string, name?: string) {
    let w;
    try {
      w = parseWorkout(fileName, text);
    } catch (e) {
      o.log(`import impossible (${fileName}) : ${e instanceof Error ? e.message : e}`);
      return;
    }
    const { blocks, warnings } = workoutToBlocks(w, o.readFtp());
    for (const m of [...w.warnings, ...warnings]) o.log(`import : ${m}`);
    open({ name: name ?? w.name, description: w.description ?? '', blocks }, true);
  }

  // --- Éditeur ---

  function open(d: Draft, unsaved = false) {
    if (dirty && !confirm('Abandonner les modifications en cours ?')) return;
    draft = d;
    dirty = unsaved;
    $('ed-title').textContent = d.id ? 'Modifier la séance' : 'Nouvelle séance';
    nameIn.value = d.name;
    descIn.value = d.description;
    editor.hidden = false;
    renderBlocks();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function close(force = false) {
    if (!force && dirty && !confirm('Fermer sans enregistrer les modifications ?')) return;
    draft = undefined;
    dirty = false;
    editor.hidden = true;
  }

  function changed() {
    dirty = true;
    refreshDerived();
  }

  /** Aperçu, statistiques, erreurs et libellés dépendant des valeurs : mis à jour sans reconstruire les champs, pour garder le focus. */
  function refreshDerived() {
    if (!draft) return;
    const ftpW = o.readFtp();
    const w = blocksToWorkout(draft.name, draft.description, draft.blocks);
    const shapes = $('ed-shapes');
    shapes.replaceChildren(
      ...profileShapes(w, ftpW, PROFILE_W, PROFILE_H).map((s) => {
        const p = document.createElementNS(SVG, 'path');
        p.setAttribute('d', s.d);
        p.setAttribute('class', s.zone);
        return p;
      }),
    );
    const s = workoutStats(w, ftpW);
    $('ed-stats').textContent = draft.blocks.length
      ? `${formatDuration(s.durationS)} · ${s.avgW} W moyens · intensité ${s.intensity.toFixed(2)} · charge estimée ${s.load} (FTP ${ftpW} W)`
      : 'Ajoute un premier bloc.';
    blocksEl.querySelectorAll<HTMLElement>('[data-duration]').forEach((x) => {
      x.textContent = formatDuration(blockDurationS(draft!.blocks[Number(x.dataset.duration)]!));
    });
    blocksEl.querySelectorAll<HTMLElement>('[data-watts]').forEach((x) => {
      const v = Number(x.dataset.value);
      x.textContent = Number.isFinite(v) && v > 0 ? `${Math.round((v / 100) * ftpW)} W` : '';
    });
    const errors = validateBlocks(draft.blocks);
    errorsEl.replaceChildren(...errors.map((e) => el('li', { textContent: e })));
    for (const id of ['ed-save', 'ed-use', 'ed-export']) $<HTMLButtonElement>(id).disabled = errors.length > 0;
  }

  /** Champ numérique ou durée lié à une propriété du bloc. */
  function field(label: string, b: EditorBlock, key: string, kind: 'duration' | 'percent' | 'count' | 'cadence') {
    const rec = b as unknown as Record<string, number | undefined>;
    const current = rec[key];
    const input = el('input', {
      type: kind === 'duration' ? 'text' : 'number',
      inputMode: kind === 'duration' ? 'numeric' : 'decimal',
      value: current === undefined ? '' : kind === 'duration' ? formatDuration(current) : String(kind === 'percent' ? pct(current) : current),
      placeholder: kind === 'cadence' ? 'libre' : kind === 'duration' ? 'mm:ss' : '',
      className: `f-${kind}`,
    });
    const bounds = { percent: ['1', '300'], count: ['1', ''], cadence: ['30', '200'], duration: ['', ''] }[kind];
    input.min = bounds[0]!;
    input.max = bounds[1]!;
    if (kind !== 'duration') input.step = '1';
    const watts = el('span', { className: 'note' });
    if (kind === 'percent') {
      watts.dataset.watts = '';
      watts.dataset.value = input.value;
    }
    input.addEventListener('input', () => {
      const raw = input.value;
      let v: number | undefined;
      if (kind === 'duration') v = parseDuration(raw);
      else if (raw.trim() === '') v = undefined;
      else v = Number(raw);
      input.classList.toggle('invalid', kind !== 'cadence' && (v === undefined || Number.isNaN(v)));
      if (kind === 'percent') {
        watts.dataset.value = raw;
        rec[key] = v === undefined ? NaN : v / 100;
      } else if (kind === 'cadence') {
        rec[key] = v && v > 0 ? v : undefined;
      } else {
        rec[key] = v === undefined ? NaN : v;
      }
      changed();
    });
    return el('label', { className: 'ed-field' }, el('span', { textContent: label }), input, kind === 'percent' ? el('span', { textContent: '%' }) : '', watts);
  }

  function blockFields(b: EditorBlock) {
    switch (b.type) {
      case 'warmup':
      case 'cooldown':
      case 'ramp':
        return [field('Durée', b, 'durationS', 'duration'), field('Début', b, 'from', 'percent'), field('Fin', b, 'to', 'percent'), field('Cadence', b, 'cadenceRpm', 'cadence')];
      case 'steady':
        return [field('Durée', b, 'durationS', 'duration'), field('Puissance', b, 'power', 'percent'), field('Cadence', b, 'cadenceRpm', 'cadence')];
      case 'intervals':
        return [
          field('Répétitions', b, 'repeat', 'count'),
          field('Effort', b, 'onS', 'duration'),
          field('à', b, 'onPower', 'percent'),
          field('Récupération', b, 'offS', 'duration'),
          field('à', b, 'offPower', 'percent'),
          field('Cadence effort', b, 'cadenceRpm', 'cadence'),
          field('Cadence récup.', b, 'restCadenceRpm', 'cadence'),
        ];
      case 'free':
        return [field('Durée', b, 'durationS', 'duration')];
    }
  }

  function renderBlocks() {
    if (!draft) return;
    const blocks = draft.blocks;
    const move = (i: number, j: number) => {
      [blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!];
      dirty = true;
      renderBlocks();
    };
    blocksEl.replaceChildren(
      ...blocks.map((b, i) => {
        const tools = el(
          'div',
          { className: 'ed-tools' },
          iconButton('↑', `Monter le bloc ${i + 1}`, () => move(i, i - 1), i === 0),
          iconButton('↓', `Descendre le bloc ${i + 1}`, () => move(i, i + 1), i === blocks.length - 1),
          iconButton('⧉', `Dupliquer le bloc ${i + 1}`, () => {
            blocks.splice(i + 1, 0, structuredClone(b));
            dirty = true;
            renderBlocks();
          }),
          iconButton('✕', `Supprimer le bloc ${i + 1}`, () => {
            blocks.splice(i, 1);
            dirty = true;
            renderBlocks();
          }),
        );
        const dur = el('span', { className: 'note' });
        dur.dataset.duration = String(i);
        return el(
          'li',
          { className: `ed-block ed-${b.type}` },
          el('div', { className: 'ed-head' }, el('strong', { textContent: `${i + 1}. ${BLOCK_LABEL[b.type]}` }), dur, tools),
          el('div', { className: 'ed-fields' }, ...blockFields(b)),
        );
      }),
    );
    refreshDerived();
  }

  function iconButton(text: string, label: string, onClick: () => void, disabled = false) {
    const b = el('button', { type: 'button', textContent: text, className: 'secondary icon', disabled });
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function save(): string | undefined {
    if (!draft || validateBlocks(draft.blocks).length) return undefined;
    try {
      const saved = o.library.save({ id: draft.id, name: draft.name.trim() || 'Séance sans nom', description: draft.description.trim() || undefined, blocks: draft.blocks });
      draft.id = saved.id;
      dirty = false;
      $('ed-title').textContent = 'Modifier la séance';
      o.log(`séance enregistrée : ${saved.name}`);
      renderLibrary();
      o.onLibraryChange();
      return saved.id;
    } catch (e) {
      o.log(`enregistrement impossible (stockage du navigateur plein ou bloqué) : ${e instanceof Error ? e.message : e}`);
      return undefined;
    }
  }

  // --- Branchements ---

  nameIn.addEventListener('input', () => {
    if (draft) draft.name = nameIn.value;
    dirty = true;
  });
  descIn.addEventListener('input', () => {
    if (draft) draft.description = descIn.value;
    dirty = true;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!draft) return;
      draft.blocks.push(defaultBlock(b.dataset.add as BlockType));
      dirty = true;
      renderBlocks();
      blocksEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }),
  );
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
    if (dirty) e.preventDefault();
  });

  renderLibrary();
  renderSamples();

  return {
    /** À appeler quand la FTP change : les watts affichés en dépendent. */
    refresh() {
      renderLibrary();
      renderSamples();
      refreshDerived();
    },
  };
}
