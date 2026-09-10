import { Droplets, House, LineChart, Package, Settings } from 'lucide-react'
import { deviceIdFromPath, devicePath } from '@/lib/device-path'

/**
 * 五個分頁。前四個綁設備（網址是 `/d/<id>/…`），設定不綁 ——
 * 設定頁自己有一份設備清單，因為它要能新增與刪除設備，
 * 那件事不可能在「某一台設備底下」進行。
 */
export const NAV_ITEMS = [
  { sub: '', label: '首頁', Icon: House },
  { sub: 'consumables', label: '耗材', Icon: Package },
  { sub: 'water', label: '水質', Icon: Droplets },
  { sub: 'report', label: '報表', Icon: LineChart },
  { sub: null, label: '設定', Icon: Settings },
] as const

export type NavItem = (typeof NAV_ITEMS)[number]

const SETTINGS_HREF = '/settings'

export function navHref(item: NavItem, deviceId: number | null): string {
  if (item.sub === null) return SETTINGS_HREF
  // 一台設備都沒有時，前四個分頁沒有可去的地方，一律導到設定頁的設備清單
  if (deviceId === null) return '/settings/devices'
  return devicePath(deviceId, item.sub)
}

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.sub === null) return pathname.startsWith(SETTINGS_HREF)
  if (deviceIdFromPath(pathname) === null) return false

  // `/d/1` 是首頁；`/d/1/water` 之後的第一段才是分頁名稱
  const rest = pathname.replace(/^\/d\/\d+/, '').replace(/^\//, '')
  const seg = rest.split('/')[0] ?? ''
  return seg === item.sub
}

/**
 * 導覽用的設備 id。
 *
 * **網址優先於 cookie。** cookie 由 proxy 在同一個請求裡才寫入，
 * 所以從切換器跳到另一台設備的那一次請求，伺服端讀到的 cookie 還是舊值 ——
 * 若用它產生分頁連結，畫面顯示的是設備 2 而分頁卻指向設備 1。
 * 網址是當下唯一可信的來源，只有網址裡沒有設備時（例如設定頁）才退回 cookie 的值。
 *
 * **但網址裡的 id 必須真的存在。** 打開一個已刪除設備的舊連結會走到 404，
 * 而那一頁的導覽列仍然由這個函式產生 —— 只看網址的話，五個分頁有四個
 * 指回同一個死掉的 id，使用者每按一次就再撞一次 404。
 * `knownDeviceIds` 讓它在那種時候退回備援值，把導覽列變回出口。
 *
 * 判準是「存在」而不是「啟用中」：停用的設備仍然可以瀏覽（見 (app)/layout.tsx），
 * 用啟用清單判斷會把那條路一起堵死。
 */
export function navDeviceId(
  pathname: string,
  fallback: number | null,
  knownDeviceIds: readonly number[],
): number | null {
  const fromPath = deviceIdFromPath(pathname)
  if (fromPath !== null && knownDeviceIds.includes(fromPath)) return fromPath
  return fallback
}
