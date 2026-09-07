import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { CategoryList } from '@/components/settings/CategoryList'
import { DeviceDangerZone } from '@/components/settings/DeviceDangerZone'
import { DeviceEditor } from '@/components/settings/DeviceEditor'
import { DeviceQrCard } from '@/components/settings/DeviceQrCard'
import { getPublicUrl } from '@/lib/config'
import { devicePath, getDevice } from '@/lib/devices'
import {
  deviceHistoryCount,
  listCategories,
  listItems,
  usageByCategory,
  usageByItem,
} from '@/lib/settings-store'

export default async function DeviceSettingsPage({ params }: PageProps<'/settings/devices/[id]'>) {
  const id = Number((await params).id)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  const device = getDevice(id)
  if (!device) notFound()

  const categories = listCategories(id)
  const items = listItems(id)
  const itemsByCategory: Record<number, typeof items> = {}
  for (const it of items) (itemsByCategory[it.categoryId] ??= []).push(it)

  const publicUrl = getPublicUrl()
  const deepLink = publicUrl ? `${publicUrl}${devicePath(id)}` : null

  return (
    <>
      <PageHeader
        title={device.name}
        action={
          <Link
            href="/settings/devices"
            className="flex items-center gap-1 text-sm text-muted-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            設備
          </Link>
        }
      />

      <div className="space-y-6 px-4 py-5 md:px-8">
        <DeviceEditor device={device} />

        <CategoryList
          deviceId={id}
          categories={categories}
          itemsByCategory={itemsByCategory}
          categoryUsage={Object.fromEntries(usageByCategory(id))}
          itemUsage={Object.fromEntries(usageByItem(id))}
        />

        <DeviceQrCard
          deviceName={device.name}
          url={deepLink}
          fallbackPath={devicePath(id)}
        />

        <DeviceDangerZone
          deviceId={id}
          deviceName={device.name}
          history={deviceHistoryCount(id)}
        />
      </div>
    </>
  )
}
