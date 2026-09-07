import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as schema from './schema'

const KEY = Symbol.for('ro-tracker.db')
const g = globalThis as unknown as Record<symbol, ReturnType<typeof create> | undefined>

function create() {
  const file = process.env.DATABASE_PATH ?? './data/app.sqlite3'
  mkdirSync(dirname(file), { recursive: true })

  const sqlite = new Database(file)

  // journal_mode 寫進資料庫檔本身，設定一次即可（重設無害）
  sqlite.pragma('journal_mode = WAL')
  // 以下為「每條連線」的設定，每次開啟都必須重下
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  // SQLite 預設不強制外鍵！不開的話 schema 裡所有的 cascade 與 restrict 都是裝飾品
  sqlite.pragma('foreign_keys = ON')

  const fk = sqlite.pragma('foreign_keys', { simple: true })
  if (fk !== 1) throw new Error('無法開啟 SQLite 外鍵約束，資料完整性無保障，拒絕啟動')

  return drizzle(sqlite, { schema })
}

export const db = g[KEY] ?? (g[KEY] = create())
export const sqlite = () => (db.$client as InstanceType<typeof Database>)
export { schema }
