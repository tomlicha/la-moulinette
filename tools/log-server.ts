/**
 * Serveur de journaux autonome : reçoit les rapports de l'application et les garde dans un fichier JSONL.
 * À héberger sur une machine joignable (VPS, Raspberry Pi derrière un tunnel…), puis renseigner
 * `VITE_LOG_ENDPOINT` et `VITE_LOG_TOKEN` au build de l'application.
 *
 * Lancer : `LOG_READ_TOKEN=… LOG_INGEST_TOKEN=… npm run logs:serve`
 *   PORT (8787), LOG_FILE (.logs/reports.jsonl), LOG_ALLOWED_ORIGIN (* par défaut : à restreindre au domaine de l'app).
 * Lire : `curl -H "Authorization: Bearer $LOG_READ_TOKEN" "http://hôte:8787/api/logs/reports?limit=20"`
 */
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { createFileStore } from './logs/file-store.ts';
import { serveWith } from './logs/node-http.ts';
import { createLogReceiver } from '../src/telemetry/receiver.ts';
import { LIMITS } from '../src/telemetry/report.ts';

const env = process.env;
if (!env.LOG_READ_TOKEN) {
  console.error('LOG_READ_TOKEN est obligatoire : sans lui, personne ne pourrait relire les rapports.');
  process.exit(1);
}
if (!env.LOG_INGEST_TOKEN) console.warn("LOG_INGEST_TOKEN absent : n'importe qui peut déposer des rapports.");

const file = env.LOG_FILE ?? '.logs/reports.jsonl';
await mkdir(dirname(file), { recursive: true });

const receiver = createLogReceiver({
  store: createFileStore(file),
  ingestToken: env.LOG_INGEST_TOKEN,
  readToken: env.LOG_READ_TOKEN,
  allowedOrigin: env.LOG_ALLOWED_ORIGIN,
});

const port = Number(env.PORT) || 8787;
createServer(async (req, res) => {
  try {
    if (!(await serveWith(receiver, req, res, LIMITS.bodyBytes))) {
      res.statusCode = 404;
      res.end();
    }
  } catch {
    res.statusCode = 500;
    res.end();
  }
}).listen(port, () => console.log(`Journaux : http://0.0.0.0:${port}/api/logs/ → ${file}`));
