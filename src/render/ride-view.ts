import * as THREE from 'three/webgpu';
import type { Route } from '../sim/route';
import { createRenderer, type Backend } from './renderer';
import { Rider } from './rider';
import { buildWorld, WORLD_HIGH, WORLD_LOW } from './world';
import { WorldPath } from './world-path';

export type Quality = 'high' | 'low';

export interface ViewState {
  /** Distance parcourue donnée par la simulation, en m. */
  distanceM: number;
  speedKmh: number;
  cadenceRpm: number;
}

export interface RenderStats {
  backend: Backend;
  fps: number;
  frameP50Ms: number;
  frameP95Ms: number;
  triangles: number;
  drawCalls: number;
}

const FRAME_WINDOW = 240;
const STATS_EVERY_MS = 500;
/** Plafond du pas de temps d'animation : un onglet qui reprend ne doit pas téléporter le cycliste. */
const MAX_DT_S = 0.1;

const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]! : 0;

/** Vue 3D de la sortie : monde, cycliste et caméra de poursuite pilotés par l'état de la simulation. */
export class RideView {
  onStats?: (s: RenderStats) => void;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 8000);
  private readonly path: WorldPath;
  private readonly rider = new Rider();
  private readonly sky: THREE.Mesh;
  private readonly frameTimes: number[] = [];
  private readonly resizeObserver: ResizeObserver;

  private state: ViewState = { distanceM: 0, speedKmh: 0, cadenceRpm: 0 };
  private dist = 0;
  private lastFrame = 0;
  private lastStats = 0;
  private raf = 0;
  private active = true;
  private cameraReady = false;

  private constructor(
    private readonly renderer: THREE.WebGPURenderer,
    readonly backend: Backend,
    private readonly canvas: HTMLCanvasElement,
    route: Route,
    quality: Quality,
  ) {
    this.path = new WorldPath(route);
    const world = buildWorld(this.path, this.scene, quality === 'high' ? WORLD_HIGH : WORLD_LOW);
    this.sky = world.sky;
    this.scene.add(this.rider.group);
    renderer.setPixelRatio(quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.place(0);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  static async create(
    canvas: HTMLCanvasElement,
    route: Route,
    opts: { forceWebGL?: boolean; quality?: Quality } = {},
  ): Promise<RideView> {
    const { renderer, backend } = await createRenderer(canvas, opts.forceWebGL);
    return new RideView(renderer, backend, canvas, route, opts.quality ?? 'high');
  }

  setState(s: ViewState) {
    this.state = s;
    // La simulation tourne à 10 Hz : on interpole entre ses mises à jour et on recale si l'écart devient grand.
    if (Math.abs(s.distanceM - this.dist) > 30) this.dist = s.distanceM;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }

  private resize() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private readonly p = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  /** Pose le cycliste à la distance `d` sur la route, incliné par la pente. */
  private place(d: number) {
    this.path.point(d, this.p);
    this.path.point(d + 2, this.ahead);
    this.rider.group.position.set(this.p.x, this.p.y + 0.04, this.p.z);
    this.rider.group.lookAt(this.ahead.x, this.ahead.y + 0.04, this.ahead.z);
  }

  private follow(dtS: number) {
    this.path.forward(this.dist, this.fwd);
    this.camTarget.set(
      this.p.x - this.fwd.x * 5.2,
      this.p.y + 2.0,
      this.p.z - this.fwd.z * 5.2,
    );
    if (!this.cameraReady) {
      this.camera.position.copy(this.camTarget);
      this.cameraReady = true;
    } else {
      this.camera.position.lerp(this.camTarget, 1 - Math.exp(-dtS * 7));
    }
    this.look.set(this.p.x + this.fwd.x * 7, this.p.y + 0.95, this.p.z + this.fwd.z * 7);
    this.camera.lookAt(this.look);
    this.sky.position.copy(this.camera.position);
  }

  /** Hors de l'écran de sortie, la vue ne dessine plus : inutile de faire chauffer le GPU pour un canevas caché. */
  setActive(on: boolean) {
    this.active = on;
    if (on && !this.raf) {
      this.lastFrame = 0;
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
  }

  private frame(now: number) {
    if (!this.active) {
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dtMs = this.lastFrame ? now - this.lastFrame : 16.7;
    this.lastFrame = now;
    const dt = Math.min(dtMs / 1000, MAX_DT_S);

    const speedMs = this.state.speedKmh / 3.6;
    this.dist += speedMs * dt;
    this.dist += (this.state.distanceM - this.dist) * Math.min(1, dt * 3); // recalage doux sur la simulation
    this.place(this.dist);
    this.rider.animate(dt, this.state.cadenceRpm, speedMs);
    this.follow(dt);
    this.renderer.render(this.scene, this.camera);

    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > FRAME_WINDOW) this.frameTimes.shift();
    if (now - this.lastStats >= STATS_EVERY_MS) {
      this.lastStats = now;
      const sorted = [...this.frameTimes].sort((a, b) => a - b);
      const mean = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      const info = this.renderer.info.render;
      this.onStats?.({
        backend: this.backend,
        fps: 1000 / mean,
        frameP50Ms: percentile(sorted, 0.5),
        frameP95Ms: percentile(sorted, 0.95),
        triangles: info.triangles,
        drawCalls: info.drawCalls,
      });
    }
  }
}
