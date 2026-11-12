import type { ConnectionState } from '../sensors/types';

export type RadarRole = 'trainer' | 'hr';

export interface RadarDevice {
  state: ConnectionState;
  /** Nom réel de l'appareil : celui qui est connecté, sinon celui mémorisé au dernier usage. */
  name?: string;
  /** Précision affichée une fois connecté (modes pilotables du trainer). */
  detail?: string;
}

/** `ok` : connecté ; `busy` : connexion ou recherche en cours ; `off` : rien de connecté ; `error` : échec. */
export type RadarTone = 'ok' | 'busy' | 'off' | 'error';

export interface RadarTag {
  /** Ce que l'appareil est pour l'application : Trainer ou Cardio. */
  role: string;
  /** Nom réel de l'appareil, en plus petit sous le rôle. */
  name: string;
  status: string;
  tone: RadarTone;
}

const ROLE_LABEL: Record<RadarRole, string> = { trainer: 'Trainer', hr: 'Cardio' };

const TONE: Record<ConnectionState, RadarTone> = { connected: 'ok', connecting: 'busy', error: 'error', disconnected: 'off' };

/** Texte de la bulle d'un appareil sur le radar. */
export function radarTag(role: RadarRole, d: RadarDevice): RadarTag {
  const status =
    d.state === 'connected'
      ? ['Connecté', d.detail].filter(Boolean).join(' · ')
      : d.state === 'connecting'
        ? 'Recherche en cours…'
        : d.state === 'error'
          ? 'Erreur de connexion'
          : 'Non connecté';
  return { role: ROLE_LABEL[role], name: d.name || 'Aucun appareil connu', status, tone: TONE[d.state] };
}

/** Modes que le trainer sait piloter, pour la précision « ERG et SIM » ; vide si aucun. */
export function controlModes(caps: { targetPower: boolean; simulation: boolean } | undefined): string {
  return [caps?.targetPower && 'ERG', caps?.simulation && 'SIM'].filter(Boolean).join(' et ');
}
