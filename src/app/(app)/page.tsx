import { redirect } from 'next/navigation'
import { devicePath, resolveDeviceId } from '@/lib/devices'

/**
 * 首頁只做一件事：把使用者送到某一台設備的頁面。
 *
 * 設備狀態放在網址而不是 cookie，所以「首頁」本身沒有內容可顯示 ——
 * 它是一個路由決策點。單一設備的使用者感受不到這一層。
 */
export default async function Home() {
  const deviceId = await resolveDeviceId()
  // 一台啟用中的設備都沒有：先去把設備建起來，其他頁面都依賴它
  if (deviceId === null) redirect('/settings/devices')
  redirect(devicePath(deviceId))
}
