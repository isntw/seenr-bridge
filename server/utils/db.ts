import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

const CACHE_KEY = '__seenrBridgeDb__'

interface DbCache {
  [CACHE_KEY]?: Database.Database
}

function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data')
}

export function useDb(): Database.Database {
  const cache = globalThis as unknown as DbCache
  if (cache[CACHE_KEY]) return cache[CACHE_KEY]!

  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })

  const db = new Database(path.join(dir, 'seenr-bridge.db'))
  db.pragma('journal_mode = WAL')

  cache[CACHE_KEY] = db
  return db
}

// Test helper: close the handle and clear the cache so the next useDb()
// re-reads DATA_DIR. Also used to release WAL locks between test files.
export function closeDb(): void {
  const cache = globalThis as unknown as DbCache
  cache[CACHE_KEY]?.close()
  delete cache[CACHE_KEY]
}
