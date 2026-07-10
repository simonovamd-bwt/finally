// Migration runner + first-run seed. Applies every .sql file in ./migrations
// (sorted by name) inside a transaction, then seeds instruments and the account
// row if the database is empty. Safe to run on every boot.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_INSTRUMENTS } from '@finally/shared';
import { config } from '../config.js';
import { db } from './connection.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

/** Apply all pending schema migrations. */
export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set<string>(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const record = db.prepare(
    'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const run = db.transaction(() => {
      db.exec(sql);
      record.run(file, Date.now());
    });
    run();
    // eslint-disable-next-line no-console
    console.log(`✔ migration applied: ${file}`);
  }
}

/** Seed instruments + the single account row on first run only. */
export function seed(): void {
  const now = Date.now();

  const instrumentCount = (
    db.prepare('SELECT COUNT(*) AS n FROM instruments').get() as { n: number }
  ).n;

  if (instrumentCount === 0) {
    const insert = db.prepare(
      `INSERT INTO instruments (symbol, name, start_price, volatility, created_at)
       VALUES (@symbol, @name, @startPrice, @volatility, @createdAt)`,
    );
    const insertAll = db.transaction(() => {
      for (const inst of SEED_INSTRUMENTS) {
        insert.run({ ...inst, createdAt: now });
      }
    });
    insertAll();
    // eslint-disable-next-line no-console
    console.log(`✔ seeded ${SEED_INSTRUMENTS.length} instruments`);
  }

  const accountExists = db.prepare('SELECT 1 FROM account WHERE id = 1').get();
  if (!accountExists) {
    db.prepare(
      `INSERT INTO account (id, cash, created_at, updated_at)
       VALUES (1, ?, ?, ?)`,
    ).run(config.STARTING_CASH, now, now);
    // eslint-disable-next-line no-console
    console.log(`✔ seeded account with cash ${config.STARTING_CASH}`);
  }
}

/** Run migrations then seed. Called once during boot. */
export function initDatabase(): void {
  migrate();
  seed();
}
