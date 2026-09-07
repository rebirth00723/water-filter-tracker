import { EventList } from '@/components/consumables/EventList'
import { DeviceHeader } from '@/components/nav/DeviceHeader'
import { todayTpe } from '@/lib/date'
import { buildPickerCategories, listEvents, recentTemplates } from '@/lib/events-store'

export default async function ConsumablesPage({ params }: PageProps<'/d/[deviceId]/consumables'>) {
  const id = Number((await params).deviceId)
  const today = todayTpe()

  return (
    <>
      <DeviceHeader deviceId={id} title="耗材紀錄" />
      <div className="px-4 py-5 md:px-8">
        <EventList
          deviceId={id}
          events={listEvents(id)}
          categories={buildPickerCategories(id, today)}
          templates={recentTemplates(id)}
          today={today}
        />
      </div>
    </>
  )
}
