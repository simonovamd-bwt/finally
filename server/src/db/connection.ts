// SQLite connection. One embedded database, WAL mode for safe concurrent reads
// while the single writer commits. The file path comes from config so it can
// live on a mounted volume and persist across container restarts.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

function open(): Database.Database {
  // Ensure the parent directory exists (e.g. /data) before opening the file.
  mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });

  const db = new Database(config.DATABASE_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  return db;
}

/** The shared database handle for the process. */
export const db: Database.Database = open();
