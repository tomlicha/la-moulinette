import type { ConnectionState, Measurement, SimulationParams, TrainerCapabilities } from '../sensors/types';
import { GradeThrottle } from '../sim/grade-throttle';
import { DEFAULT_RIDER } from '../sim/physics';
import { Ride, type RideSnapshot } from '../sim/ride';
import type { Route } from '../sim/route';
import { ClimbCounter, PowerAverage } from '../ui/hud-model';
import { errMsg } from '../util/errors';
import type { LogFn } from '../util/log';
import { ErgFollower } from '../workout/erg-follower';
import { STEP_LABEL, type Workout } from '../workout/model';
import { WorkoutRunner, type WorkoutState } from '../workout/runner';

/** Ce que la session demande au trainer ; `SensorHub` le fournit. */
export interface SessionTrainer {
  setTargetPower(watts: number): Promise<void>;
  setSimulation(p: SimulationParams): Promise<void>;
}

export interface SessionOptions {
  trainer: SessionTrainer;
  route: Route;
  log: LogFn;
  /** Pente réglée à la main, envoyée quand l'ERG est relâché hors sortie virtuelle. */
  manualGradePct: () => number;
  /** L'état affichable a changé (boutons, libellés). */
  onChange?: () => void;
  /** Nouvel état de la sortie virtuelle, à chaque pas. */
  onRide?: (s: RideSnapshot) => void;
  /** Sortie virtuelle arrêtée, à cette distance. */
  onRideStopped?: (distanceM: number) => void;
  /** Séance démarrée. */
  onWorkoutStarted?: () => void;
  /** Séance menée jusqu'à la fin de son dernier palier (pas arrêtée à la main). */
  onWorkoutFinished?: () => void;
  now?: () => number;
  later?: (fn: () => void, ms: number) => void;
}

/** Au-delà de ce délai sans mesure, une valeur n'est plus jugée fraîche (puissance à 0 pour la simulation). */
export const STALE_MS = 3000;
/** Après un envoi raté, on attend avant de réessayer pour ne pas marteler le trainer. */
const RETRY_MS = 2000;

export interface Readings {
  powerW?: number;
  heartRateBpm?: number;
  cadenceRpm?: number;
  speedKmh?: number;
}

type Reading = { v: number; at: number };

/**
 * Coordination de la sortie virtuelle, de l'ERG et de la séance structurée, sans DOM : l'interface appelle les
 * méthodes, lit l'état et se redessine sur `onChange`. Toutes les règles qui décident quoi envoyer au trainer
 * et quand sont ici, testables avec un faux trainer et une fausse horloge.
 */
export class TrainingSession {
  connection: ConnectionState = 'disconnected';
  capabilities: TrainerCapabilities = { targetPower: false, simulation: false };
  /** ERG engagé : la consigne de puissance prime, et l'envoi de la pente du parcours est suspendu pour ne pas la remplacer. */
  ergActive = false;
  /** Dernier état de la sortie virtuelle (gardé après l'arrêt). */
  lastRide?: RideSnapshot;
  /** Dernier état de la séance en cours. */
  workoutState?: WorkoutState;
  paused = false;

  /** Puissance moyenne sur 3 s et dénivelé positif, pour le HUD. */
  readonly power3s = new PowerAverage();
  readonly climb = new ClimbCounter();

  private ride?: Ride;
  private rideLastTick = 0;
  private readonly throttle = new GradeThrottle();
  private readonly last: Partial<Record<keyof Readings, Reading>> = {};

  private runner?: WorkoutRunner;
  private readonly follower = new ErgFollower();
  private woLastTick = 0;
  /** L'ERG a été désengagé à la main pendant la séance : elle continue sans imposer de consigne jusqu'au réengagement. */
  private ergOptOut = false;
  private sending = false;
  private holdUntil = 0;

  private readonly now: () => number;
  private readonly later: (fn: () => void, ms: number) => void;

  constructor(private readonly o: SessionOptions) {
    this.now = o.now ?? (() => performance.now());
    this.later = o.later ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  get connected() {
    return this.connection === 'connected';
  }

  get riding() {
    return !!this.ride;
  }

  get riderMassKg() {
    return this.ride?.rider.massKg;
  }

  /** Séance en cours, s'il y en a une. */
  get workout(): { workout: Workout; ftpW: number; intensity: number } | undefined {
    const r = this.runner;
    return r && { workout: r.workout, ftpW: r.ftpW, intensity: r.intensity };
  }

  /** Mode de résistance du trainer, s'il est piloté. */
  get control(): 'erg' | 'sim' | undefined {
    return this.ergActive ? 'erg' : this.ride && this.capabilities.simulation ? 'sim' : undefined;
  }

  // --- Trainer et mesures ---

  setConnection(s: ConnectionState, capabilities: TrainerCapabilities) {
    this.connection = s;
    this.capabilities = capabilities;
    // Trainer perdu (déconnecté, ou reconnexion abandonnée) : plus de sortie ni d'ERG.
    if (s === 'disconnected' || s === 'error') {
      this.stopRide(false);
      this.setErg(false);
    }
    this.changed();
  }

  onMeasurement(m: Measurement) {
    const at = this.now();
    if (m.powerW !== undefined) {
      this.last.powerW = { v: m.powerW, at };
      this.power3s.push(m.powerW, at);
    }
    if (m.cadenceRpm !== undefined) this.last.cadenceRpm = { v: m.cadenceRpm, at };
    if (m.heartRateBpm !== undefined) this.last.heartRateBpm = { v: m.heartRateBpm, at };
    if (m.speedKmh !== undefined) this.last.speedKmh = { v: m.speedKmh, at };
  }

  private fresh(k: keyof Readings): number | undefined {
    const r = this.last[k];
    return r && this.now() - r.at <= STALE_MS ? r.v : undefined;
  }

  /** Mesures à afficher : puissance 3 s, valeurs fraîches ; pendant la sortie, la vitesse virtuelle. */
  readings(): Readings {
    return {
      powerW: this.power3s.value(this.now()),
      heartRateBpm: this.fresh('heartRateBpm'),
      cadenceRpm: this.fresh('cadenceRpm'),
      speedKmh: this.ride && this.lastRide ? this.lastRide.speedKmh : this.fresh('speedKmh'),
    };
  }

  /** À appeler à intervalle régulier (100 ms) : fait avancer la sortie et la séance. */
  tick() {
    this.tickRide();
    this.tickWorkout();
  }

  // --- Sortie virtuelle ---

  startRide(massKg: number) {
    if (this.ride) return;
    this.ride = new Ride(this.o.route, { ...DEFAULT_RIDER, massKg });
    this.lastRide = this.ride.snapshot();
    this.climb.reset();
    this.throttle.reset();
    this.rideLastTick = this.now();
    this.o.log(`sortie virtuelle démarrée (${massKg} kg)`);
    this.changed();
  }

  stopRide(resetTrainer = true) {
    const ride = this.ride;
    if (!ride) return;
    this.ride = undefined;
    this.setErg(false);
    this.o.onRideStopped?.(ride.snapshot().distanceM);
    this.o.log('sortie virtuelle arrêtée');
    if (resetTrainer && this.connected) void this.o.trainer.setSimulation({ gradePct: 0 }).catch(() => {});
    this.changed();
  }

  private tickRide() {
    const ride = this.ride;
    if (!ride) return;
    const now = this.now();
    const s = ride.advance((now - this.rideLastTick) / 1000, this.fresh('powerW') ?? 0);
    this.rideLastTick = now;
    this.lastRide = s;
    this.climb.add(s.altitudeM);
    this.o.onRide?.(s);

    if (this.connected && this.capabilities.simulation && !this.ergActive && this.throttle.shouldSend(s.gradePct, now)) {
      this.throttle.markSent(s.gradePct, now);
      this.o.trainer.setSimulation({ gradePct: s.gradePct, massKg: ride.rider.massKg }).catch((e) => {
        this.o.log(`pente non envoyée : ${errMsg(e)}`, 'error');
        this.later(() => this.throttle.reset(), RETRY_MS); // nouvel essai, sans marteler le trainer
      });
    }
  }

  // --- ERG et SIM à la main ---

  private setErg(on: boolean) {
    if (this.ergActive === on) return;
    this.ergActive = on;
    if (!on) this.throttle.reset(); // en sortie, la prochaine mise à jour renvoie la pente du parcours
    this.changed();
  }

  private async send(label: string, fn: () => Promise<void>): Promise<boolean> {
    try {
      await fn();
      this.o.log(`${label} envoyé`);
      return true;
    } catch (e) {
      this.o.log(`${label} refusé : ${errMsg(e)}`, 'error');
      return false;
    }
  }

  /** Bouton ERG : engage la consigne `targetW`, ou désengage l'ERG. */
  async toggleErg(targetW: number): Promise<void> {
    if (this.ergActive) {
      this.setErg(false);
      if (this.runner) {
        this.ergOptOut = true;
        this.o.log('ERG désengagé : la séance continue sans imposer de consigne');
      }
      if (this.ride) {
        this.o.log('ERG désengagé : pente du parcours reprise');
      } else {
        // Hors sortie, le trainer ne quitte l'ERG qu'avec une consigne de pente.
        const g = this.o.manualGradePct();
        await this.send(`ERG désengagé, SIM ${g} %`, () => this.o.trainer.setSimulation({ gradePct: g }));
      }
      return;
    }
    // Pendant une séance, réengager rend la main à la séance, qui renvoie aussitôt sa consigne du moment.
    if (this.runner) {
      this.ergOptOut = false;
      this.follower.reset();
      this.o.log('ERG réengagé : la séance reprend sa consigne');
      this.tickWorkout();
      return;
    }
    if (await this.send(`ERG ${targetW} W`, () => this.o.trainer.setTargetPower(targetW))) this.setErg(true);
  }

  /** Cible ERG changée à la main : appliquée aussitôt si l'ERG est engagé hors séance. */
  changeErgTarget(targetW: number) {
    if (!this.ergActive || this.runner) return; // en séance, c'est la séance qui fixe la consigne
    void this.send(`ERG ${targetW} W`, () => this.o.trainer.setTargetPower(targetW));
  }

  /** Bouton SIM : impose une pente ; le SIM remplace l'ERG. */
  async sendGrade(gradePct: number) {
    if (await this.send(`SIM ${gradePct} %`, () => this.o.trainer.setSimulation({ gradePct }))) this.setErg(false);
  }

  // --- Séance structurée ---

  startWorkout(workout: Workout, ftpW: number) {
    if (this.runner) return;
    this.runner = new WorkoutRunner(workout, ftpW);
    this.paused = false;
    this.ergOptOut = false;
    this.holdUntil = 0;
    this.follower.reset();
    this.woLastTick = this.now();
    this.o.log(`séance démarrée : ${workout.name}, FTP ${ftpW} W`);
    this.o.onWorkoutStarted?.();
    this.tickWorkout();
    this.changed();
  }

  togglePause() {
    if (!this.runner) return;
    this.paused = !this.paused;
    this.follower.reset();
    this.o.log(this.paused ? 'séance en pause' : 'séance reprise');
    this.changed();
  }

  skipStep() {
    if (!this.runner) return;
    const s = this.runner.skip();
    this.follower.reset();
    this.o.log(`séance : palier suivant (${STEP_LABEL[s.step.kind]})`);
    this.tickWorkout();
  }

  /** Intensité de la séance ajustée de `delta` (±0,05), bornée à 50–150 %. */
  nudgeIntensity(delta: number) {
    if (!this.runner) return;
    this.runner.intensity = Math.min(1.5, Math.max(0.5, Math.round((this.runner.intensity + delta) * 100) / 100));
    this.follower.reset();
    this.changed();
  }

  setFtp(ftpW: number) {
    if (this.runner) this.runner.ftpW = ftpW;
  }

  stopWorkout(reason = 'séance arrêtée') {
    if (!this.runner) return;
    this.runner = undefined;
    this.workoutState = undefined;
    this.paused = false;
    this.ergOptOut = false;
    if (this.ergActive) this.releaseErg(reason);
    else this.o.log(reason);
    this.changed();
  }

  /** Relâche l'ERG pris par la séance : hors sortie virtuelle, le trainer ne le quitte qu'avec une consigne de pente. */
  private releaseErg(reason: string) {
    if (!this.ergActive) return;
    this.setErg(false);
    if (this.ride || !this.connected) return this.o.log(reason);
    const g = this.o.manualGradePct();
    void this.send(`${reason}, SIM ${g} %`, () => this.o.trainer.setSimulation({ gradePct: g }));
  }

  private tickWorkout() {
    const runner = this.runner;
    if (!runner) return;
    const now = this.now();
    const dt = (now - this.woLastTick) / 1000;
    this.woLastTick = now;
    // Sans trainer connecté, le temps de séance s'arrête : on ne compte pas un palier que personne ne pédale.
    const running = !this.paused && this.connected;
    const s = running ? runner.advance(dt) : runner.state();
    this.workoutState = s;
    if (s.done) {
      this.o.onWorkoutFinished?.();
      return this.stopWorkout('séance terminée');
    }
    if (!running || this.ergOptOut || this.sending || now < this.holdUntil) return;

    if (s.targetW === undefined) {
      this.follower.reset();
      return this.releaseErg(`palier ${STEP_LABEL[s.step.kind].toLowerCase()} : ERG relâché`);
    }
    if (!this.ergActive) this.follower.reset(); // ERG relâché ailleurs (fin de sortie, reconnexion) : on le reprend aussitôt
    const w = this.follower.next(s, now);
    if (w === undefined) return;
    this.sending = true;
    this.o.trainer
      .setTargetPower(w)
      .then(() => {
        if (this.ergActive) return;
        this.setErg(true);
        this.o.log(`séance : ERG engagé à ${w} W`);
      })
      .catch((e) => {
        this.o.log(`séance : consigne ${w} W non envoyée (${errMsg(e)})`, 'error');
        this.follower.reset();
        this.holdUntil = this.now() + RETRY_MS;
      })
      .finally(() => (this.sending = false));
  }

  private changed() {
    this.o.onChange?.();
  }
}
