import { ArrowLeft, QrCode } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { CategoryList } from '@/components/settings/CategoryList'
import { DeviceDangerZone } from '@/components/settings/DeviceDangerZone'
import { DeviceEditor } from '@/components/settings/DeviceEditor'
import { Card } from '@/components/ui'
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

        {/* 專屬連結與 QR Code：產生器在階段 6，但連結現在就有用 */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">專屬連結</h2>
          <Card className="space-y-2 px-4 py-3.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              這台設備的記錄頁網址。印一張 QR 貼在機器上，掃了直接進到這一台，
              不必記網址也不必先切換設備。
            </p>
            <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
              {deepLink ?? devicePath(id)}
            </code>
            {!deepLink && (
              <p className="text-xs text-warning">
                尚未設定對外網址，所以只能顯示相對路徑。到管理中心填入 PUBLIC_URL
                之後這裡才會出現可以直接掃的完整網址 ——
                從瀏覽器當下的位址推導會產生一個掃了進不去的 QR，所以刻意不那樣做。
              </p>
            )}
            <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
              <QrCode className="size-4" aria-hidden />
              QR Code 下載在階段 6 實作（圖片會燒進設備名稱）
            </p>
          </Card>
        </section>

        <DeviceDangerZone
          deviceId={id}
          deviceName={device.name}
          history={deviceHistoryCount(id)}
        />
      </div>
    </>
  )
}
