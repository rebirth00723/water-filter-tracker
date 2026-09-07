import { PageHeader } from '@/components/PageHeader'
import { DeviceList } from '@/components/settings/DeviceList'
import { listDevices } from '@/lib/devices'

export default function DevicesSettingsPage() {
  return (
    <>
      <PageHeader title="設備" />
      <div className="px-4 py-5 md:px-8">
        <DeviceList devices={listDevices()} />
      </div>
    </>
  )
}
