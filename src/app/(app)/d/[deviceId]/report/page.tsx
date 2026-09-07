import { DeviceHeader } from '@/components/nav/DeviceHeader'
import { getDevice } from '@/lib/devices'

export default async function ReportPage({ params }: PageProps<'/d/[deviceId]/report'>) {
  const id = Number((await params).deviceId)
  const device = getDevice(id)!

  return (
    <>
      <DeviceHeader deviceId={id} title="報表" />
      <div className="px-4 py-6 text-sm text-muted-foreground md:px-8">
        階段 8 實作：{device.name} 的 PPM 折線圖與各種類更換泳道。
      </div>
    </>
  )
}
