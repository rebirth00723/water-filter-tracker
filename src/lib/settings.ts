import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { settings } from './db/schema'

/**
 * 使用者偏好。與 machine_config 分開的理由是**匯出範圍** ——
 * settings 會被 JSON 匯出帶走（換機器時你會想保留同樣的提醒設定），
 * 而 machine_config 放的是憑證與站台專屬值，匯出等於外洩。
 */
export const SETTING_KEYS = {
  notifySendTime: 'notify.sendTime',
  notifyCatchupMaxDays: 'notify.catchupMaxDays',
  auditKeepDays: 'audit.keepDays',
} as const

export function getSetting(key: string, fallback: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  const v = row?.value?.trim()
  return v ? v : fallback
}

export function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value: value.trim() })
    .onConflictDoUpdate({ target: settings.key, set: { value: value.trim(), updatedAt: Date.now() } })
    .run()
}

export function allSettings(): Record<string, string> {
  return Object.fromEntries(db.select().from(settings).all().map((r) => [r.key, r.value]))
}
