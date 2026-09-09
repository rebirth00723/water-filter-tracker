import { APP_TIME_ZONE } from './date'
import { runMigrations } from './db/migrate'
import { seedIfEmpty } from './db/seed'
import { log } from './log'
import { startSchedule } from './notify/schedule'

const KEY = Symbol.for('ro-tracker.booted')
const g = globalThis as unknown as Record<symbol, boolean | undefined>

/**
 * 只在 Node runtime 執行一次。三重防護：
 * 1. instrumentation.ts 先擋掉非 nodejs runtime
 * 2. 這裡的 globalThis symbol 擋掉開發模式 HMR 的重複求值
 * 3. 排程本身另有 croner 的 protect
 */
export function boot() {
  if (g[KEY]) return
  g[KEY] = true

  try {
    const started = Date.now()
    runMigrations()
    seedIfEmpty()
    startSchedule()

    // 主機時間與時區印出來：所有的到期日、通知發送時刻與 YYYY-MM-DD 都由它決定，
    // 而「差一天」的症狀看起來會像業務邏輯壞掉，第一眼先排除掉時區問題最省事。
    log.info('啟動完成', {
      ms: Date.now() - started,
      hostTime: new Date().toISOString(),
      tz: process.env.TZ ?? '(未設定，使用系統時區)',
      resolvedTimeZone: APP_TIME_ZONE,
      node: process.version,
      db: process.env.DATABASE_PATH ?? './data/app.sqlite3',
    })
  } catch (err) {
    // 帶著壞掉的 schema 提供服務比直接死掉更糟
    log.error('啟動失敗', { err })
    process.exit(1)
  }
}
