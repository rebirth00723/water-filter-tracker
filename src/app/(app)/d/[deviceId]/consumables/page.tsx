import { DeviceHeader } from '@/components/nav/DeviceHeader'
import { getDevice } from '@/lib/devices'

export default async function ConsumablesPage({ params }: PageProps<'/d/[deviceId]/consumables'>) {
  const id = Number((await params).deviceId)
  const device = getDevice(id)!

  return (
    <>
      <DeviceHeader deviceId={id} title="耗材紀錄" />
      <div className="px-4 py-6 text-sm text-muted-foreground md:px-8">
        階段 4 實作：{device.name} 的更換與新購紀錄、成本、與水質紀錄的連動。
      </div>
    </>
  )
}
