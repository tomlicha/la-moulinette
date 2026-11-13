import { HeartRateMonitor } from './sensors/heart-rate-monitor';
import { SensorHub } from './sensors/hub';
import { SimulatedTrainer } from './sensors/simulator';
import { WebBluetoothTrainer } from './sensors/web-bluetooth';
import { webBluetoothAvailable } from './sensors/gatt-device';
import type { RideView } from './render/ride-view';
import { DEFAULT_RIDER } from './sim/physics';
import { setupExport } from './export/wiring';
import { setupTelemetry } from './telemetry/wiring';
import { DEMO_ROUTE } from './sim/route';
import type { ConnectionState, TrainerAdapter, TrainerCapabilities } from './sensors/types';
import { STEP_LABEL, type Workout } from './workout/model';
import { profileShapes } from './workout/profile';
import { parseWorkout, type WorkoutState } from './workout/runner';
import { browserStore, canRecallDevices, DeviceRegistry, recallDevices, type DeviceRole } from './sensors/device-registry';
import { ALL_PROTOCOLS, PROTOCOL_LABEL, type ControlProtocol } from './sensors/trainer-profiles';
import { formatDuration } from './ui/duration';
import { setBlocked, setupBlockedHints, type BlockReason } from './ui/blocked';
import { $ } from './ui/dom';
import { setupRouter } from './ui/router';
import { setupWorkoutEditor } from './ui/workout-editor';
import { RideHud } from './ui/hud';
import { createRadar } from './ui/radar';
import { setupHomeBackground } from './ui/home-background';
import { controlModes } from './ui/radar-model';
import { blocksToWorkout } from './workout/blocks';
import { WorkoutLibrary } from './workout/library';
import { SAMPLE_WORKOUTS } from './workout/samples';
import { TrainingSession } from './session/session';
import { errMsg } from './util/errors';
import type { LogLevel } from './util/log';
import { every } from './util/ticker';

/*
 * Point d'entrée : relie la page aux capteurs et à la session (src/session/session.ts). Les règles de la sortie,
 * de l'ERG et de la séance vivent dans la session ; ce fichier ne fait que brancher des boutons et redessiner.
 */

setupBlockedHints();

// --- Éléments de la page ---

const el = {
  state: $('state'),
  stateHr: $('state-hr'),
  caps: $('caps'),
  log: $('log'),
  support: $('support'),
  connectBle: $<HTMLButtonElement>('connect-ble'),
  connectBleOther: $<HTMLButtonElement>('connect-ble-other'),
  connectSim: $<HTMLButtonElement>('connect-sim'),
  connectHr: $<HTMLButtonElement>('connect-hr'),
  connectHrOther: $<HTMLButtonElement>('connect-hr-other'),
  disconnect: $<HTMLButtonElement>('disconnect'),
  disconnectHr: $<HTMLButtonElement>('disconnect-hr'),
  forget: { trainer: $<HTMLButtonElement>('forget-trainer'), hr: $<HTMLButtonElement>('forget-hr') },
  known: { trainer: $('trainer-known'), hr: $('hr-known') },
  status: { trainer: $('status-trainer'), hr: $('status-hr') },
  goRide: $<HTMLButtonElement>('go-ride'),
  sortieHint: $('sortie-hint'),
  recallNote: $('recall-note'),
  erg: $<HTMLButtonElement>('erg-send'),
  sim: $<HTMLButtonElement>('sim-send'),
  ergInput: $<HTMLInputElement>('erg'),
  gradeInput: $<HTMLInputElement>('grade'),
  gradeOut: $('grade-out'),
  ride: $<HTMLButtonElement>('ride-toggle'),
  mass: $<HTMLInputElement>('mass'),
  wo: {
    select: $<HTMLSelectElement>('wo-select'),
    ftp: $<HTMLInputElement>('wo-ftp'),
    start: $<HTMLButtonElement>('wo-start'),
    pause: $<HTMLButtonElement>('wo-pause'),
    skip: $<HTMLButtonElement>('wo-skip'),
    stop: $<HTMLButtonElement>('wo-stop'),
    easier: $<HTMLButtonElement>('wo-easier'),
    harder: $<HTMLButtonElement>('wo-harder'),
    shapes: $<SVGGElement>('wo-shapes'),
    cursor: $<SVGLineElement>('wo-cursor'),
    name: $('wo-name'),
    next: $('wo-next'),
    message: $('wo-message'),
    intensity: $('wo-intensity'),
  },
  viewStats: $('view-stats'),
  canvas: $<HTMLCanvasElement>('view'),
  protocol: $<HTMLSelectElement>('trainer-protocol'),
  card: { trainer: $('card-trainer'), hr: $('card-hr') },
  // Accueil : même séance et même profil que l'écran de sortie, raccourcis vers la sortie.
  home: {
    shapes: $<SVGGElement>('home-wo-shapes'),
    select: $<HTMLSelectElement>('home-wo-select'),
    start: $<HTMLButtonElement>('home-wo-start'),
    ride: $<HTMLButtonElement>('home-ride'),
    meta: $('home-wo-meta'),
  },
};

// --- Journal ---

/** Au-delà, les plus anciennes lignes du journal visible sont retirées : il resterait sinon à grossir toute la sortie. */
const LOG_LINES = 2000;

function log(msg: string, level: LogLevel = 'info') {
  const ts = new Date().toLocaleTimeString('fr-FR');
  el.log.append(`${ts}  ${msg}\n`);
  while (el.log.childNodes.length > LOG_LINES) el.log.firstChild!.remove();
  el.log.scrollTop = el.log.scrollHeight;
  telemetry.record(msg, level);
}

// Envoie le journal au serveur de logs dès qu'une erreur survient (voir src/telemetry/). Le contexte n'est lu qu'à l'envoi.
const telemetry = setupTelemetry({
  log,
  context: () => ({
    trainer: trainer?.name,
    trainerState: roleState.trainer,
    capabilities: trainer?.capabilities,
    trainerIdentity: trainer instanceof WebBluetoothTrainer ? trainer.identity : undefined,
    heartRateState: roleState.hr,
    rideRunning: session.riding,
  }),
});

// --- Capteurs et session ---

const NO_CAPS: TrainerCapabilities = { targetPower: false, simulation: false };
const hub = new SensorHub();
let trainer: TrainerAdapter | undefined;
let hrMonitor: HeartRateMonitor | undefined;
let view: RideView | undefined;
const registry = new DeviceRegistry();
const roleState: Record<DeviceRole, ConnectionState> = { trainer: 'disconnected', hr: 'disconnected' };
/** Appareils que l'application tente de retrouver seule au lancement ; vide une fois cette phase terminée. */
const launchPending = new Set<DeviceRole>();
/** Même radar sur l'écran Appareils (grand) et sur l'accueil (réduit) : rôle de l'appareil et nom réel dans chaque bulle. */
const radars = [createRadar($('radar-devices'), 'full'), createRadar($('radar-home'), 'mini')];
// Fond de l'accueil : trois scènes qui se relaient toutes les minutes.
setupHomeBackground($('home-scenes'), $('home-title'), $('home-desc'));

const session = new TrainingSession({
  trainer: hub,
  route: DEMO_ROUTE,
  log,
  manualGradePct: () => Number(el.gradeInput.value),
  onChange: () => refreshControls(),
  onRide: (s) => {
    exporter.onRide(s);
    view?.setState({ distanceM: s.distanceM, speedKmh: s.speedKmh, cadenceRpm: session.readings().cadenceRpm ?? 0 });
  },
  onRideStopped: (distanceM) => view?.setState({ distanceM, speedKmh: 0, cadenceRpm: 0 }),
});

const exporter = setupExport({
  hub,
  button: $<HTMLButtonElement>('export-fit'),
  stravaButton: $<HTMLButtonElement>('export-strava'),
  intervalsButton: $<HTMLButtonElement>('export-intervals'),
  log,
});

/** Protocole de pilotage imposé depuis l'aide de l'écran Appareils ; vide = choix automatique selon le modèle. */
const PROTOCOL_KEY = 'zwift2.trainerProtocol';
const prefs = browserStore();
const savedProtocol = prefs.getItem(PROTOCOL_KEY) as ControlProtocol | null;
el.protocol.value = savedProtocol && ALL_PROTOCOLS.includes(savedProtocol) ? savedProtocol : '';
el.protocol.addEventListener('change', () => {
  try {
    if (el.protocol.value) prefs.setItem(PROTOCOL_KEY, el.protocol.value);
    else prefs.removeItem(PROTOCOL_KEY);
  } catch {
    // stockage bloqué : le choix vaut pour cette session
  }
  log(`protocole de pilotage : ${el.protocol.value ? PROTOCOL_LABEL[el.protocol.value as ControlProtocol] : 'automatique'}, appliqué à la prochaine connexion`);
});

function newBleTrainer(): WebBluetoothTrainer {
  const t = new WebBluetoothTrainer();
  t.forcedProtocol = (el.protocol.value || undefined) as ControlProtocol | undefined;
  return t;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const fmtTime = (s: number) => formatDuration(Math.floor(s));

hub.on('log', (msg, level) => log(msg, level));
hub.on('raw', (src, data) => {
  // Les trames brutes servent à documenter chaque modèle de trainer ; on ne journalise pas tout le flux.
  if (src !== 'Indoor Bike Data' && src !== 'Heart Rate' && src !== 'Cycling Power' && src !== 'FE-C') log(`${src} : ${hex(data)}`);
});
hub.on('measurement', (m) => session.onMeasurement(m));

/** Raison « pas de trainer », avec le raccourci qui mène à l'écran des appareils. */
const needTrainer = (text: string): BlockReason => ({
  text,
  action: { label: 'Connecter le trainer', run: () => router.go('appareils') },
});
const noControl = (what: string): BlockReason => ({
  text: `${trainer?.name ?? 'Cet appareil'} mesure ta puissance mais ne pilote pas la résistance (pas de ${what}). Il faut un home trainer connecté pour ça.`,
  action: { label: 'Changer d’appareil', run: () => router.go('appareils') },
});

function onTrainerState(s: ConnectionState, detail?: string) {
  roleState.trainer = s;
  exporter.onTrainerState(s);
  el.state.dataset.s = s;
  el.state.textContent = `trainer : ${detail ? `${s} · ${detail}` : s}`;
  if (s === 'connected' && trainer) {
    const c = trainer.capabilities;
    const range = c.powerRange ? `, plage ${c.powerRange.min}–${c.powerRange.max} W` : '';
    const id = trainer instanceof WebBluetoothTrainer ? trainer.identity : undefined;
    const model = id ? `${id.profile.label}${id.info.firmware ? ` (firmware ${id.info.firmware})` : ''} · pilotage ${id.protocol ? PROTOCOL_LABEL[id.protocol] : 'aucun'} · ` : '';
    el.caps.textContent = `${model}ERG : ${c.targetPower ? 'oui' : 'non'} · SIM : ${c.simulation ? 'oui' : 'non'}${range}${id?.advice ? `. ${id.advice}` : ''}`;
  }
  session.setConnection(s, trainer?.capabilities ?? NO_CAPS); // redessine les commandes par onChange
  renderDevices();
}

/** Disponibilité et libellés des commandes de la sortie et de la séance, d'après l'état de la session. */
function refreshControls() {
  const connected = session.connected;
  const caps = session.capabilities;
  setBlocked(el.disconnect, connected ? undefined : 'Aucun trainer connecté.');
  setBlocked(
    el.erg,
    !connected
      ? needTrainer('Connecte d’abord ton home trainer pour lui imposer une puissance.')
      : !caps.targetPower
        ? noControl('mode ERG')
        : undefined,
  );
  setBlocked(
    el.sim,
    !connected
      ? needTrainer('Connecte d’abord ton home trainer pour lui imposer une pente.')
      : !caps.simulation
        ? noControl('mode SIM')
        : session.riding
          ? 'Pendant la sortie virtuelle, la pente vient du parcours. Arrête la sortie pour régler la pente à la main.'
          : undefined,
  );
  // La puissance seule suffit à rouler : la pente n'est envoyée que si le trainer sait la simuler.
  const needPowerToRide = connected ? undefined : needTrainer('La sortie avance avec la puissance de ton home trainer : connecte-le d’abord.');
  setBlocked(el.ride, needPowerToRide);
  setBlocked(el.home.ride, needPowerToRide);
  el.erg.textContent = session.ergActive ? "Désengager l'ERG" : "Engager l'ERG";
  el.erg.classList.toggle('secondary', session.ergActive);
  el.ride.textContent = session.riding ? 'Arrêter la sortie' : 'Démarrer la sortie';
  el.mass.readOnly = session.riding;
  el.mass.title = session.riding ? 'La masse se règle avant de démarrer la sortie.' : '';

  const running = session.workout;
  const startReason = running
    ? 'La séance est déjà en cours.'
    : !workout
      ? 'Choisis d’abord une séance dans la liste.'
      : !connected
        ? needTrainer('La séance pilote la résistance de ton home trainer : connecte-le d’abord.')
        : !caps.targetPower
          ? noControl('mode ERG')
          : undefined;
  setBlocked(el.wo.start, startReason);
  setBlocked(el.home.start, startReason);
  for (const b of [el.wo.pause, el.wo.skip, el.wo.stop, el.wo.easier, el.wo.harder]) {
    setBlocked(b, running ? undefined : 'Démarre d’abord la séance.');
  }
  el.wo.pause.textContent = session.paused ? 'Reprendre' : 'Pause';
  el.wo.intensity.textContent = `${Math.round((running?.intensity ?? 1) * 100)} %`;
  renderWorkout(session.workoutState);
}

// --- Connexion des appareils ---

function attach(t: TrainerAdapter) {
  // L'adaptateur remplacé peut encore attendre son appareil : il ne doit pas s'y reconnecter dans notre dos.
  if (trainer && trainer !== t) void trainer.disconnect();
  trainer = t;
  hub.attachTrainer(t);
  t.on('state', (s, d) => {
    if (trainer !== t) return; // ancien adaptateur remplacé par un nouveau choix d'appareil
    onTrainerState(s, d);
    log(`trainer : ${s}${d ? ` (${d})` : ''}`, s === 'error' ? 'error' : 'info');
    if (s === 'connected' && t instanceof WebBluetoothTrainer && t.deviceId) {
      registry.remember('trainer', { id: t.deviceId, name: t.name });
      renderDevices();
    }
    maybeLeaveDevices();
  });
}

async function start(t: TrainerAdapter, nameHint?: string) {
  attach(t);
  try {
    await t.connect(nameHint);
  } catch (e) {
    log(`échec de connexion : ${errMsg(e)}`, 'error');
  }
}

function newHeartRateMonitor(): HeartRateMonitor {
  const m = new HeartRateMonitor();
  void hrMonitor?.disconnect(); // voir attach()
  hrMonitor = m;
  hub.attachHeartRate(m);
  m.on('state', (s, d) => {
    if (hrMonitor !== m) return;
    roleState.hr = s;
    el.stateHr.dataset.s = s;
    el.stateHr.textContent = `cardio : ${d ? `${s} · ${d}` : s}`;
    log(`cardio : ${s}${d ? ` (${d})` : ''}`, s === 'error' ? 'error' : 'info');
    if (s === 'connected' && m.deviceId) registry.remember('hr', { id: m.deviceId, name: m.name });
    renderDevices();
    maybeLeaveDevices();
  });
  return m;
}

const connectHrWith = (hint?: string) =>
  void newHeartRateMonitor()
    .connect(hint)
    .catch((e: unknown) => log(`échec cardio : ${errMsg(e)}`, 'error'));

el.connectHr.addEventListener('click', () => connectHrWith(registry.get('hr')?.name));
el.connectHrOther.addEventListener('click', () => connectHrWith());
el.disconnectHr.addEventListener('click', () => void hrMonitor?.disconnect());
el.connectBle.addEventListener('click', () => void start(newBleTrainer(), registry.get('trainer')?.name));
el.connectBleOther.addEventListener('click', () => void start(newBleTrainer()));
el.connectSim.addEventListener('click', () => void start(new SimulatedTrainer()));
for (const role of ['trainer', 'hr'] as const) {
  el.forget[role].addEventListener('click', () => {
    const known = registry.get(role);
    if (!known || !confirm(`Oublier « ${known.name} » ? Il ne sera plus reconnecté au lancement.`)) return;
    registry.forget(role);
    log(`appareil oublié : ${known.name}`);
    renderDevices();
  });
}
el.disconnect.addEventListener('click', () => void trainer?.disconnect());

// --- Commandes manuelles et sortie virtuelle ---

el.erg.addEventListener('click', () => void session.toggleErg(Number(el.ergInput.value)));
// Changer la cible pendant que l'ERG est engagé l'applique aussitôt.
el.ergInput.addEventListener('change', () => session.changeErgTarget(Number(el.ergInput.value)));
el.sim.addEventListener('click', () => void session.sendGrade(Number(el.gradeInput.value)));
el.gradeInput.addEventListener('input', () => {
  el.gradeOut.textContent = `${el.gradeInput.value} %`;
});
const riderMassKg = () => Number(el.mass.value) || DEFAULT_RIDER.massKg;
el.ride.addEventListener('click', () => (session.riding ? session.stopRide() : session.startRide(riderMassKg())));

// --- Séance structurée ---

const PROFILE_W = 1000;
const PROFILE_H = 120;
const FTP_KEY = 'zwift2.ftp';
/** Séance choisie dans la liste, pas forcément démarrée. */
let workout: Workout | undefined;

try {
  const saved = Number(localStorage.getItem(FTP_KEY));
  if (saved >= 50) el.wo.ftp.value = String(saved);
} catch {
  // stockage indisponible (navigation privée) : on garde la valeur par défaut
}
const readFtp = () => (Number(el.wo.ftp.value) >= 50 ? Number(el.wo.ftp.value) : 200);

function renderProfile() {
  el.wo.shapes.replaceChildren();
  el.home.shapes.replaceChildren();
  el.home.meta.textContent = workout ? `${workout.name} · ${fmtTime(workout.steps.reduce((t, s) => t + s.durationS, 0))}` : 'Aucune séance choisie.';
  if (!workout) return;
  for (const s of profileShapes(workout, readFtp(), PROFILE_W, PROFILE_H)) {
    for (const target of [el.wo.shapes, el.home.shapes]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', s.d);
      path.setAttribute('class', s.zone);
      target.append(path);
    }
  }
}

/** Valeur du sélecteur : `lib:<id>` pour une séance de l'utilisateur, `sample:<id>` pour un modèle. */
function workoutFromChoice(value: string): Workout | undefined {
  const [kind, id] = value.split(':');
  if (kind === 'lib') {
    const saved = library.get(id ?? '');
    return saved && blocksToWorkout(saved.name, saved.description, saved.blocks);
  }
  const sample = SAMPLE_WORKOUTS.find((s) => s.id === id);
  if (!sample) return undefined;
  try {
    return parseWorkout(sample.fileName, sample.text);
  } catch (e) {
    log(`séance illisible (${sample.fileName}) : ${errMsg(e)}`, 'error');
    return undefined;
  }
}

function refreshWorkoutChoices() {
  const keep = el.wo.select.value;
  const opt = (value: string, label: string) => Object.assign(document.createElement('option'), { value, textContent: label });
  const mine = document.createElement('optgroup');
  mine.label = 'Mes séances';
  mine.append(...library.list().map((w) => opt(`lib:${w.id}`, w.name)));
  const samples = document.createElement('optgroup');
  samples.label = 'Modèles';
  samples.append(...SAMPLE_WORKOUTS.map((s) => opt(`sample:${s.id}`, parseWorkout(s.fileName, s.text).name)));
  el.wo.select.replaceChildren(opt('', '— choisir une séance —'), ...(mine.children.length ? [mine] : []), samples);
  el.wo.select.value = [...el.wo.select.options].some((o) => o.value === keep) ? keep : '';
  syncHomeSelect();
}

/** Le sélecteur de l'accueil reprend les choix de celui de la sortie, et sa valeur. */
function syncHomeSelect() {
  el.home.select.replaceChildren(...[...el.wo.select.children].map((c) => c.cloneNode(true)));
  el.home.select.value = el.wo.select.value;
}

function chooseWorkout(value: string) {
  if (session.workout) {
    log("séance en cours : l'arrêter avant d'en choisir une autre");
    return;
  }
  el.wo.select.value = value;
  el.home.select.value = value;
  workout = value ? workoutFromChoice(value) : undefined;
  if (!workout) {
    el.wo.name.textContent = 'Aucune séance choisie.';
  } else {
    for (const x of workout.warnings) log(`séance : ${x}`);
    const total = workout.steps.reduce((t, s) => t + s.durationS, 0);
    el.wo.name.textContent = `${workout.name} · ${fmtTime(total)}${workout.description ? ` · ${workout.description}` : ''}`;
    log(`séance choisie : ${workout.name} (${workout.steps.length} paliers, ${fmtTime(total)})`);
  }
  renderProfile();
  refreshControls();
}

let shownWorkoutState: WorkoutState | undefined;

function renderWorkout(s: WorkoutState | undefined) {
  if (s === shownWorkoutState) return;
  shownWorkoutState = s;
  const x = s ? (s.elapsedS / (s.totalS || 1)) * PROFILE_W : 0;
  el.wo.cursor.setAttribute('x1', String(x));
  el.wo.cursor.setAttribute('x2', String(x));
  el.wo.shapes.querySelectorAll('path').forEach((p, i) => p.classList.toggle('past', !!s && i < s.stepIndex));

  if (!s) {
    el.wo.next.textContent = '';
    el.wo.message.hidden = true;
    return;
  }
  el.wo.next.textContent = s.next
    ? `Ensuite : ${STEP_LABEL[s.next.kind]}, ${s.nextTargetW === undefined ? 'libre' : `${s.nextTargetW} W`}, ${fmtTime(s.next.durationS)}`
    : 'Dernier palier';
  el.wo.message.hidden = !s.message;
  el.wo.message.textContent = s.message ?? '';
}

el.wo.select.addEventListener('change', () => chooseWorkout(el.wo.select.value));
el.wo.ftp.addEventListener('change', () => {
  try {
    localStorage.setItem(FTP_KEY, String(readFtp()));
  } catch {
    // préférence non mémorisée, sans conséquence
  }
  session.setFtp(readFtp());
  renderProfile();
  editor.refresh();
});
function startWorkout() {
  if (!workout) return;
  // La séance se roule sur le parcours : sans sortie en cours, le cycliste resterait immobile dans la vue.
  if (!session.riding && session.connected) session.startRide(riderMassKg());
  session.startWorkout(workout, readFtp());
}

el.home.select.addEventListener('change', () => chooseWorkout(el.home.select.value));
el.home.start.addEventListener('click', () => {
  router.go('sortie');
  startWorkout();
});
el.home.ride.addEventListener('click', () => {
  router.go('sortie');
  if (!session.riding) session.startRide(riderMassKg());
});
el.wo.start.addEventListener('click', startWorkout);
el.wo.pause.addEventListener('click', () => session.togglePause());
el.wo.skip.addEventListener('click', () => session.skipStep());
el.wo.stop.addEventListener('click', () => session.stopWorkout());
el.wo.easier.addEventListener('click', () => session.nudgeIntensity(-0.05));
el.wo.harder.addEventListener('click', () => session.nudgeIntensity(0.05));

// --- Écrans, appareils connus et reconnexion au lancement ---

const library = new WorkoutLibrary();
const editor = setupWorkoutEditor({
  library,
  readFtp,
  log,
  onLibraryChange: refreshWorkoutChoices,
  onUse: (id) => {
    router.go('sortie');
    chooseWorkout(`lib:${id}`);
  },
  onUseSample: (id) => {
    router.go('sortie');
    chooseWorkout(`sample:${id}`);
  },
  onRide: (id) => {
    router.go('sortie');
    chooseWorkout(`lib:${id}`);
    // Une séance déjà en cours n'est pas remplacée : chooseWorkout l'a signalé dans le journal.
    if (!session.workout) startWorkout();
  },
});
refreshWorkoutChoices();

const router = setupRouter((v) => view?.setActive(v === 'sortie'));

const STATUS_LABEL: Record<ConnectionState, string> = {
  connected: 'connecté',
  connecting: 'connexion…',
  error: 'erreur',
  disconnected: 'déconnecté',
};

function renderDevices() {
  const t = registry.get('trainer');
  const h = registry.get('hr');
  // Un appareil attendu (éteint) n'occupe pas le rôle : on peut toujours en choisir un autre.
  const waitingT = trainer instanceof WebBluetoothTrainer && trainer.waitingForDevice;
  const busyT = roleState.trainer === 'connected' || (roleState.trainer === 'connecting' && !waitingT);
  const busyH = roleState.hr === 'connected' || (roleState.hr === 'connecting' && !hrMonitor?.waitingForDevice);
  el.known.trainer.textContent = t ? `Connu : ${t.name}` : 'Aucun trainer connu.';
  el.known.hr.textContent = h ? `Connue : ${h.name}` : 'Aucune ceinture connue. Facultatif.';
  el.connectBle.textContent = t ? `Reconnecter ${t.name}` : 'Rechercher un trainer';
  el.connectHr.textContent = h ? `Reconnecter ${h.name}` : 'Rechercher une ceinture';
  const bt = webBluetoothAvailable();
  const noBt = 'Le Bluetooth web n’existe que dans Chrome ou Edge, sur ordinateur ou Android. Ici, seul le trainer simulé est disponible.';
  const trainerBusy =
    roleState.trainer === 'connected' ? 'Un trainer est déjà connecté : déconnecte-le d’abord pour en changer.' : 'Connexion du trainer en cours…';
  const hrBusy =
    roleState.hr === 'connected' ? 'Une ceinture est déjà connectée : déconnecte-la d’abord pour en changer.' : 'Connexion de la ceinture en cours…';
  const trainerReason = !bt ? noBt : busyT ? trainerBusy : undefined;
  const hrReason = !bt ? noBt : busyH ? hrBusy : undefined;
  setBlocked(el.connectBle, trainerReason);
  setBlocked(el.connectHr, hrReason);
  setBlocked(el.connectSim, busyT ? trainerBusy : undefined);
  el.connectBleOther.hidden = !t;
  setBlocked(el.connectBleOther, trainerReason);
  el.connectHrOther.hidden = !h;
  setBlocked(el.connectHrOther, hrReason);
  el.forget.trainer.hidden = !t;
  el.forget.hr.hidden = !h;
  setBlocked(el.disconnectHr, roleState.hr === 'connected' ? undefined : 'Aucune ceinture connectée.');
  setBlocked(
    el.goRide,
    roleState.trainer === 'connected' ? undefined : 'Connecte d’abord ton home trainer, ou choisis « Continuer sans trainer » juste à côté.',
  );
  el.sortieHint.hidden = roleState.trainer === 'connected';
  for (const [role, label] of [['trainer', 'trainer'], ['hr', 'cardio']] as const) {
    el.status[role].dataset.s = roleState[role];
    el.status[role].textContent = `${label} : ${STATUS_LABEL[roleState[role]]}`;
    el.card[role].dataset.s = roleState[role];
  }
  // Nom réel : celui de l'appareil connecté ; sinon le dernier appareil mémorisé, que la reconnexion cherche.
  const radarDevices = {
    trainer: {
      state: roleState.trainer,
      name: (roleState.trainer === 'connected' ? trainer?.name : undefined) ?? t?.name,
      detail: roleState.trainer === 'connected' ? controlModes(trainer?.capabilities) : undefined,
    },
    hr: { state: roleState.hr, name: (roleState.hr === 'connected' ? hrMonitor?.name : undefined) ?? h?.name },
  };
  for (const r of radars) r.update(radarDevices);
}

/**
 * Pendant la reconnexion du lancement : dès que le trainer est connecté et que les autres appareils connus
 * ont abouti (connectés ou en échec), on passe à la sortie sans attendre de clic.
 */
function maybeLeaveDevices() {
  if (!launchPending.size || roleState.trainer !== 'connected') return;
  const settled = [...launchPending].every((r) => roleState[r] === 'connected' || roleState[r] === 'error');
  if (!settled) return;
  launchPending.clear();
  if (router.current() !== 'appareils') return;
  log("appareils connus reconnectés : passage à l'accueil");
  setTimeout(() => router.current() === 'appareils' && router.go('accueil'), 800);
}

async function reconnectKnownDevices() {
  const known = registry.list();
  const note = el.recallNote;
  renderDevices();
  if (!webBluetoothAvailable()) return;
  if (!known.length) {
    note.textContent = 'Première utilisation : connecte ton home trainer pour commencer. Il sera reconnu aux prochains lancements.';
    return;
  }
  if (!canRecallDevices()) {
    note.textContent = 'Ce navigateur ne permet pas de retrouver les appareils sans clic : un clic sur « Reconnecter » par appareil suffit.';
    // Limite connue de ce navigateur, pas une panne : aucun rapport d'erreur.
    log('reconnexion automatique indisponible : navigator.bluetooth.getDevices() absent');
    return;
  }
  note.textContent = 'Reconnexion automatique aux appareils connus…';
  let found: Map<DeviceRole, BluetoothDevice>;
  try {
    found = await recallDevices(known);
  } catch (e) {
    note.textContent = 'Reconnexion automatique impossible : un clic sur « Reconnecter » par appareil suffit.';
    log(`getDevices() a échoué : ${errMsg(e)}`, 'error');
    return;
  }
  for (const k of known) {
    if (!found.has(k.role)) log(`${k.name} : autorisation du site perdue, à reconnecter d'un clic`);
  }
  if (!found.size) {
    note.textContent = 'Les autorisations Bluetooth de ce site ont été effacées : un clic sur « Reconnecter » par appareil suffit.';
    return;
  }
  for (const role of found.keys()) launchPending.add(role);
  const td = found.get('trainer');
  if (td) {
    const t = newBleTrainer();
    attach(t);
    void t.connectDevice(td, true);
  }
  const hd = found.get('hr');
  if (hd) void newHeartRateMonitor().connectDevice(hd, true);
  note.textContent = `Reconnexion automatique : ${[...found.values()].map((d) => d.name ?? 'appareil').join(', ')}. Allume-les si ce n'est pas déjà fait.`;
}

el.goRide.addEventListener('click', () => router.go('accueil'));
$('copy-log').addEventListener('click', () => void navigator.clipboard.writeText(el.log.textContent ?? ''));

el.support.textContent = webBluetoothAvailable()
  ? 'Web Bluetooth disponible.'
  : 'Web Bluetooth indisponible ici (Chrome ou Edge, en HTTPS ou sur localhost). Le trainer simulé reste utilisable.';

// --- HUD et vue 3D ---

const params = new URLSearchParams(location.search);

// HUD posé sur la vue 3D (docs/design/hud.md). En qualité réduite, panneaux sans flou.
const hud = new RideHud($('hud'), DEMO_ROUTE, { flat: params.get('quality') === 'low' });
function renderHud() {
  if (router.current() !== 'sortie') return;
  const w = session.workout;
  hud.update({
    ...session.readings(),
    ftpW: w?.ftpW ?? readFtp(),
    ride: session.riding && session.lastRide ? { snapshot: session.lastRide, climbM: session.climb.total } : undefined,
    workout: w && session.workoutState ? { workout: w.workout, state: session.workoutState, ftpW: w.ftpW, intensity: w.intensity } : undefined,
    control: session.control,
    trainerConnected: roleState.trainer === 'connected',
    heartRateConnected: roleState.hr === 'connected',
  });
}
setInterval(renderHud, 250); // affichage seulement : un ralentissement en arrière-plan est sans conséquence

// Three.js (le gros du code de l'application) n'est chargé qu'ici : l'écran des appareils, le premier affiché, n'en a pas besoin.
import('./render/ride-view')
  .then(({ RideView }) =>
    RideView.create(el.canvas, DEMO_ROUTE, {
      forceWebGL: params.get('renderer') === 'webgl2',
      quality: params.get('quality') === 'low' ? 'low' : 'high',
    }),
  )
  .then((v) => {
    view = v;
    v.setActive(router.current() === 'sortie');
    v.onStats = (s) => {
      el.viewStats.textContent =
        `${s.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · ${s.fps.toFixed(0)} i/s · ` +
        `p50 ${s.frameP50Ms.toFixed(1)} ms · p95 ${s.frameP95Ms.toFixed(1)} ms · ` +
        `${(s.triangles / 1000).toFixed(0)} k triangles · ${s.drawCalls} appels`;
    };
    log(`rendu 3D : ${v.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}`);
  })
  .catch((e: unknown) => {
    el.viewStats.textContent = 'rendu 3D indisponible';
    log(`rendu 3D indisponible : ${errMsg(e)}`, 'error');
  });

// En dernier : tout l'état de la page est initialisé avant la première connexion.
onTrainerState('disconnected'); // chaque bouton reçoit dès le départ sa raison d'être indisponible
// La sortie et la séance avancent sur un minuteur qui ne ralentit pas quand l'onglet est caché (voir util/ticker.ts).
every(100, () => {
  session.tick();
  renderWorkout(session.workoutState);
});
void reconnectKnownDevices();
