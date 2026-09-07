import { StatusCards } from '@/components/home/StatusCards'
import { DeviceHeader } from '@/components/nav/DeviceHeader'
import { Card } from '@/components/ui'
import { todayTpe } from '@/lib/date'
import { getDevice } from '@/lib/devices'
import { categoryDues } from '@/lib/events-store'
import { latestReading } from '@/lib/readings-store'

export default async function DeviceHome({ params }: PageProps<'/d/[deviceId]'>) {
  const id = Number((await params).deviceId)
  // layout 已經驗過這台設備存在
  const device = getDevice(id)!

  return (
    <>
      <DeviceHeader deviceId={id} title={device.name} />
      <div className="space-y-4 px-4 py-5 md:px-8">
        {!device.active && (
          <Card className="border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            這台設備目前是停用狀態，不會出現在切換器與提醒裡。歷史紀錄仍完整保留。
          </Card>
        )}
        <StatusCards
          deviceId={id}
          dues={categoryDues(id, todayTpe())}
          latest={latestReading(id)}
        />
      </div>
    </>
  )
}
