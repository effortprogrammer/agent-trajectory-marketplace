-- Waitlist — the waitlist is the conversion engine of this site.
-- Applied on deploy (only when app.manifest.json sets "db": true).
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  product TEXT NOT NULL DEFAULT 'atm',
  source TEXT DEFAULT 'waitlist',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dedupe on email + product so a re-submit is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email_product ON waitlist (email, product);

CREATE TABLE IF NOT EXISTS waitlist_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  event TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
