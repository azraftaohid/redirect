-- Links. slug uses SQLite's default BINARY collation => case-sensitive uniqueness (D7).
CREATE TABLE links (
  id              TEXT PRIMARY KEY,                 -- crypto.randomUUID()
  slug            TEXT NOT NULL UNIQUE,
  target_url      TEXT NOT NULL,
  title           TEXT,
  status_code     INTEGER NOT NULL DEFAULT 307 CHECK (status_code IN (301, 302, 307, 308)),
  tags            TEXT NOT NULL DEFAULT '[]',       -- JSON array, queried with json_each()
  is_active       INTEGER NOT NULL DEFAULT 1,
  forward_query   INTEGER NOT NULL DEFAULT 1,
  expires_at      TEXT,                             -- ISO-8601 UTC or NULL
  click_count     INTEGER NOT NULL DEFAULT 0,       -- NOT indexed (see cost rules)
  last_clicked_at TEXT,                             -- NOT indexed
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_links_created_at ON links (created_at);

-- Clicks per link per UTC day. 1 row written per counted click.
CREATE TABLE link_daily_clicks (
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,                            -- 'YYYY-MM-DD' (UTC)
  clicks  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day)
) WITHOUT ROWID;

-- Optional breakdowns (only written when enabled via ANALYTICS_DIMENSIONS).
CREATE TABLE link_daily_dims (
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  dim     TEXT NOT NULL CHECK (dim IN ('country', 'referrer')),
  value   TEXT NOT NULL,
  clicks  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day, dim, value)
) WITHOUT ROWID;
