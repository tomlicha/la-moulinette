-- Un rapport par ligne ; `body` est le StoredReport en JSON (src/telemetry/report.ts).
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at INTEGER NOT NULL,
  session     TEXT    NOT NULL,
  body        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_received_at ON reports (received_at);
