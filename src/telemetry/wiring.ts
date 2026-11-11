import { LogBuffer } from './log-buffer';
import { createReporter } from './reporter';

export interface TelemetryOptions {
  /** État du moment, joint à chaque rapport (trainer, connexion…). Appelé au moment de l'envoi. */
  context: () => Record<string, unknown>;
  /** Journal visible de la page : y sont aussi inscrites les erreurs que le navigateur remonte seul. */
  log: (msg: string) => void;
}

/**
 * Adresse du récepteur : `VITE_LOG_ENDPOINT` (build de production), ou le relais du serveur de dev. Sans l'une ni l'autre,
 * rien ne quitte jamais le navigateur.
 */
function endpoint(): string | undefined {
  const configured = (import.meta.env.VITE_LOG_ENDPOINT as string | undefined)?.trim();
  if (configured) return configured;
  return import.meta.env.DEV ? '/api/logs/ingest' : undefined;
}

const reason = (e: unknown) => (e instanceof Error ? `${e.name} : ${e.message}` : String(e));

export function setupTelemetry(opts: TelemetryOptions): { record(msg: string): void } {
  const url = endpoint();
  if (!url) return { record() {} };

  const buffer = new LogBuffer();
  const reporter = createReporter(buffer, {
    endpoint: url,
    token: (import.meta.env.VITE_LOG_TOKEN as string | undefined) || undefined,
    session: crypto.randomUUID(),
    context: () => ({
      ...opts.context(),
      userAgent: navigator.userAgent,
      language: navigator.language,
      online: navigator.onLine,
      secureContext: isSecureContext,
      webBluetooth: 'bluetooth' in navigator,
      page: location.pathname + location.hash,
    }),
  });

  // Une erreur partie hors ligne repart dès que le réseau revient, ou à la fermeture de la page.
  addEventListener('online', () => void reporter.retry('online'));
  addEventListener('pagehide', () => void reporter.retry('pagehide'));
  addEventListener('error', (e) => opts.log(`erreur non gérée : ${e.message} (${e.filename}:${e.lineno})`));
  addEventListener('unhandledrejection', (e) => opts.log(`erreur non gérée (promesse) : ${reason(e.reason)}`));

  return {
    record(msg) {
      reporter.notify(buffer.add(msg));
    },
  };
}
