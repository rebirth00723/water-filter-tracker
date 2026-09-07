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
 */
export function navDeviceId(pathname: string, fallback: number | null): number | null {
  return deviceIdFromPath(pathname) ?? fallback
}
