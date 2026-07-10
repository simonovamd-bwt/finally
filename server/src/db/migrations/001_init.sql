-- Initial schema. Applied idempotently on boot by db/migrate.ts.

CREATE TABLE IF NOT EXISTS instruments (
  symbol      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  start_price REAL NOT NULL,
  volatility  REAL NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  cash       REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  symbol     TEXT PRIMARY KEY REFERENCES instruments(symbol),
  quantity   REAL NOT NULL,
  avg_price  REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  symbol      TEXT NOT NULL REFERENCES instruments(symbol),
  side        TEXT NOT NULL CHECK (side IN ('buy','sell')),
  type        TEXT NOT NULL CHECK (type IN ('market','limit')),
  quantity    REAL NOT NULL,
  limit_price REAL,
  status      TEXT NOT NULL CHECK (status IN ('pending','filled','rejected','cancelled')),
  source      TEXT NOT NULL CHECK (source IN ('human','ai')),
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fills (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id),
  symbol     TEXT NOT NULL,
  side       TEXT NOT NULL,
  quantity   REAL NOT NULL,
  price      REAL NOT NULL,
  fee        REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fills_created  ON fills(created_at DESC);
