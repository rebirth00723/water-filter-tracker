import { notFound } from 'next/navigation'
import { getDevice } from '@/lib/devices'

/**
 * 設備層的守門。
 *
 * `deviceId` 來自網址，所以每一次都要驗 —— 使用者可能帶著舊書籤回來、
 * 掃到一張貼在已拆掉的機器上的 QR、或手動改網址。
 * 驗不過就 404，而不是靜默退回第一台設備：**悄悄換一台機器顯示資料，
 * 比明確報錯危險得多**（使用者會把這台的濾心紀錄記到那一台上）。
 *
 * 停用中的設備仍然可以瀏覽 —— 停用只是「不出現在切換器與首頁」，
 * 不是「不能看」。舊連結還能打開，才有辦法回頭查歷史。
 */
export default async function DeviceLayout({ children, params }: LayoutProps<'/d/[deviceId]'>) {
  const { deviceId } = await params
  const id = Number(deviceId)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  if (!getDevice(id)) notFound()

  return <>{children}</>
}
