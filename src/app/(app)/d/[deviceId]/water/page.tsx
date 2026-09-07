import { DeviceHeader } from '@/components/nav/DeviceHeader'
import { getDevice } from '@/lib/devices'

export default async function WaterPage({ params }: PageProps<'/d/[deviceId]/water'>) {
  const id = Number((await params).deviceId)
  const device = getDevice(id)!

  return (
    <>
      <DeviceHeader deviceId={id} title="水質紀錄" />
      <div className="px-4 py-6 text-sm text-muted-foreground md:px-8">
        階段 3 實作：{device.name} 的原水與純水 PPM 紀錄。
      </div>
    </>
  )
}
