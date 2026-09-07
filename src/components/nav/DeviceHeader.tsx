import { PageHeader } from '@/components/PageHeader'
import { listActiveDevices } from '@/lib/devices'
import { DeviceSwitcher } from './DeviceSwitcher'

/**
 * 設備底下每一頁的頁首：頁面標題 + 設備切換器。
 *
 * 做成元件而不是放在 layout 裡，是為了避免兩條並排的橫條 ——
 * 手機上的垂直空間很貴，標題與切換器擠在同一列才划算。
 * 代價是每一頁都要查一次設備清單，但那是一張小表上的索引查詢，
 * 而這些頁面本來就是 force-dynamic，沒有可以被浪費掉的快取。
 */
export async function DeviceHeader({
  deviceId,
  title,
  action,
}: {
  deviceId: number
  title: string
  action?: React.ReactNode
}) {
  const devices = listActiveDevices()

  return (
    <PageHeader
      title={title}
      action={
        <div className="flex items-center gap-2">
          <DeviceSwitcher
            devices={devices.map((d) => ({ id: d.id, name: d.name, model: d.model }))}
            currentId={deviceId}
          />
          {action}
        </div>
      }
    />
  )
}
