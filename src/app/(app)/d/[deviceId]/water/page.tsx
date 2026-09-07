import { DeviceHeader } from '@/components/nav/DeviceHeader'
import { WaterList } from '@/components/water/WaterList'
import { todayTpe } from '@/lib/date'
import { listReadings } from '@/lib/readings-store'

export default async function WaterPage({ params }: PageProps<'/d/[deviceId]/water'>) {
  const id = Number((await params).deviceId)
  const rows = listReadings(id)

  return (
    <>
      <DeviceHeader deviceId={id} title="水質紀錄" />
      <div className="px-4 py-5 md:px-8">
        {/* 今天由伺服器以 Asia/Taipei 算好傳下去：瀏覽器的時區未必相同 */}
        <WaterList deviceId={id} rows={rows} today={todayTpe()} />
      </div>
    </>
  )
}
