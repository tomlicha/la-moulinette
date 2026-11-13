/**
 * Niveau d'une ligne du journal. `error` déclenche l'envoi d'un rapport (voir src/telemetry/) : il est réservé
 * aux vraies pannes, jamais à un geste de l'utilisateur (sélecteur fermé) ni à une limite connue du navigateur.
 */
export type LogLevel = 'info' | 'error';

export type LogFn = (msg: string, level?: LogLevel) => void;
