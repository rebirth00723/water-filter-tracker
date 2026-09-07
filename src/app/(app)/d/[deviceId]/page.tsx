import Link from 'next/link'
import { DeviceHeader } from '@/components/nav/DeviceHeader'
import { Badge, Card, EmptyState, buttonClass } from '@/components/ui'
import { fmtZh } from '@/lib/date'
import { getDevice } from '@/lib/devices'
import { listCategories, listItems } from '@/lib/settings-store'

export default async function DeviceHome({ params }: PageProps<'/d/[deviceId]'>) {
  const id = Number((await params).deviceId)
  // layout 已經驗過這台設備存在，所以這裡拿到的一定不是 undefined
  const device = getDevice(id)!
  const categories = listCategories(id).filter((c) => c.active)
  const items = listItems(id).filter((i) => i.active)

  return (
    <>
      <DeviceHeader deviceId={id} title={device.name} />
      <div className="space-y-4 px-4 py-5 md:px-8">
        {!device.active && (
          <Card className="border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            這台設備目前是停用狀態，不會出現在切換器與提醒裡。歷史紀錄仍完整保留。
          </Card>
        )}

        <Card className="px-4 py-3.5">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">型號</dt>
              <dd>{device.model ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">裝機日</dt>
              <dd>{device.installedOn ? fmtZh(device.installedOn) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">啟用中的種類</dt>
              <dd className="tabular">{categories.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">啟用中的耗材</dt>
              <dd className="tabular">{items.length}</dd>
            </div>
          </dl>
        </Card>

        {items.length === 0 ? (
          <EmptyState
            title="還沒有任何耗材品項"
            description="系統刻意不預載耗材 —— 每個人用的濾心品牌與規格都不一樣。先去設定裡建立你實際會買的品項，之後記錄更換時就能一鍵挑選。"
            action={
              <Link href={`/settings/devices/${id}`} className={buttonClass('primary')}>
                設定這台設備的耗材
              </Link>
            }
          />
        ) : (
          <Card className="px-4 py-3.5 text-sm text-muted-foreground">
            <p>
              到期狀態卡在階段 5 實作，需要先有更換紀錄才算得出下次更換日。
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-1.5">
              目前已設定
              {categories.map((c) => (
                <Badge key={c.id} tone="muted">
                  {c.name}
                </Badge>
              ))}
            </p>
          </Card>
        )}
      </div>
    </>
  )
}
