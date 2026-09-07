import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './index'

/** 同步執行，且必須在開始服務請求之前完成 */
export function runMigrations() {
  const folder = process.env.MIGRATIONS_DIR ?? './drizzle'
  migrate(db, { migrationsFolder: folder })
}
