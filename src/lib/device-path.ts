/**
 * 設備網址的純函式，**刻意不匯入資料庫** ——
 * `proxy.ts` 需要用到 `deviceIdFromPath`，而 proxy 每個請求都跑、不該碰 DB，
 * 把 better-sqlite3 拉進 proxy 的模組圖也只會製造打包問題。
 */

export const LAST_DEVICE_COOKIE = 'wft_last_device'

/** 從 `/d/<id>/…` 取出設備 id。proxy 與頁面共用這一份解析，避免兩邊規則漂移 */
export function deviceIdFromPath(pathname: string): number | null {
  const m = /^\/d\/(\d+)(?:\/|$)/.exec(pathname)
  if (!m) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 該設備底下的分頁路徑。`sub` 留空＝該設備首頁 */
export function devicePath(deviceId: number, sub = ''): string {
  return sub ? `/d/${deviceId}/${sub}` : `/d/${deviceId}`
}

/**
 * 把「同一個分頁、換一台設備」的網址算出來，用於頁首的設備切換器。
 * 切換時要停在同一個分頁而不是跳回首頁 —— 使用者比較兩台設備的水質時，
 * 每次都被丟回首頁會非常煩。
 */
export function swapDeviceInPath(pathname: string, nextDeviceId: number): string {
  const m = /^\/d\/\d+(\/.*)?$/.exec(pathname)
  if (!m) return devicePath(nextDeviceId)
  return `/d/${nextDeviceId}${m[1] ?? ''}`
}
