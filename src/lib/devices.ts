import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { db } from './db'
import { devices } from './db/schema'
import {
  LAST_DEVICE_COOKIE,
  deviceIdFromPath,
  devicePath,
  swapDeviceInPath,
} from './device-path'

/**
 * 設備放在網址路徑裡（`/d/<deviceId>/…`），不存 cookie。
 *
 * 這樣每台飲水機都有自己一組專屬連結，可以各自印一張 QR 貼在機器上 ——
 * 掃了直接進到那一台的記錄頁，不必先切換設備。這正是實際使用情境：
 * 人站在某一台機器前面，手上拿著剛換下來的濾心。
 *
 * cookie 只降級為「最後使用的設備」，唯一用途是決定 `/` 要導向哪一台，
 * 不再是狀態的來源 —— 因此兩個分頁分別開兩台設備不會互相覆蓋，
 * 上一頁／書籤／分享連結也都指向正確的設備。
 */
export type Device = typeof devices.$inferSelect

export { LAST_DEVICE_COOKIE, deviceIdFromPath, devicePath, swapDeviceInPath }

export function listDevices(): Device[] {
  return db.select().from(devices).orderBy(asc(devices.sort), asc(devices.id)).all()
}

export function listActiveDevices(): Device[] {
  return db
    .select()
    .from(devices)
    .where(eq(devices.active, true))
    .orderBy(asc(devices.sort), asc(devices.id))
    .all()
}

export function getDevice(id: number): Device | undefined {
  return db.select().from(devices).where(eq(devices.id, id)).get()
}

/**
 * `/` 要導向哪一台：cookie 記的那台優先，但**必須驗證它還存在且啟用中** ——
 * 設備被刪掉或停用之後，cookie 裡的舊 id 會讓首頁導向一個 404。
 * 驗不過就退回第一台啟用中的設備；一台都沒有回 null（呼叫端導去設定頁）。
 */
export async function resolveDeviceId(): Promise<number | null> {
  const active = listActiveDevices()
  if (active.length === 0) return null

  const raw = (await cookies()).get(LAST_DEVICE_COOKIE)?.value
  const remembered = raw ? Number(raw) : NaN
  if (Number.isSafeInteger(remembered) && active.some((d) => d.id === remembered)) {
    return remembered
  }
  return active[0].id
}
