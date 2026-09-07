import { AlertTriangle, CalendarClock, CircleHelp, PackageCheck } from 'lucide-react'
import Link from 'next/link'
import { Badge, Card, ColorDot, EmptyState, buttonClass } from '@/components/ui'
import { fmtZh } from '@/lib/date'
import { devicePath } from '@/lib/device-path'
import { basisLabel } from '@/lib/due'
import type { CategoryDue } from '@/lib/events-store'
import { rejectionRate } from '@/lib/ppm'
import type { Reading } from '@/lib/readings-store'
import { cn } from '@/lib/utils'

/**
 * 首頁狀態卡。
 *
 * 排序刻意是「逾期 → 即將到期 → 已購入待換 → 其餘」而不是照種類順序：
 * 這一頁存在的理由是回答「我現在該做什麼」，
 * 照第一道到第六道排會讓最急的那一項埋在中間。
 */
const ORDER: Record<CategoryDue['status'], number> = {
  OVERDUE: 0,
  SOON: 1,
  PURCHASED: 2,
  UNSET: 3,
  OK: 4,
}

export function StatusCards({
  deviceId,
  dues,
  latest,
}: {
  deviceId: number
  dues: CategoryDue[]
  latest: Reading | undefined
}) {
  const active = dues.filter((d) => d.active)
  const sorted = [...active].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || a.sort - b.sort,
  )
  const needsAttention = sorted.filter(
    (d) => d.status === 'OVERDUE' || d.status === 'SOON' || d.status === 'PURCHASED',
  )
  const unset = sorted.filter((d) => d.status === 'UNSET')

  if (active.length === 0) {
    return (
      <EmptyState
        title="這台設備還沒有種類"
        description="種類是「第一道」「RO」這種濾心的位置。到期提醒與報表泳道都以種類為單位。"
        action={
          <Link href={`/settings/devices/${deviceId}`} className={buttonClass('primary')}>
            去設定
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* 最近的水質。放在最上面是因為它是唯一「看一眼就知道機器好不好」的數字 */}
      <Card className="px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xs text-muted-foreground">最近水質</h2>
            {latest ? (
              <>
                <p className="mt-1 flex items-baseline gap-3">
                  <span>
                    <span className="text-xs text-muted-foreground">原水 </span>
                    <strong className="tabular text-lg" style={{ color: 'var(--chart-raw)' }}>
                      {latest.rawPpm}
                    </strong>
                  </span>
                  <span>
                    <span className="text-xs text-muted-foreground">純水 </span>
                    <strong className="tabular text-lg" style={{ color: 'var(--chart-pure)' }}>
                      {latest.purePpm}
                    </strong>
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {fmtZh(latest.measuredOn)}
                  {(() => {
                    const r = rejectionRate(latest.rawPpm, latest.purePpm)
                    return r === null ? '' : ` · 去除率 ${r.toFixed(1)}%`
                  })()}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">還沒有紀錄</p>
            )}
          </div>
          <Link href={devicePath(deviceId, 'water')} className={buttonClass('secondary', 'sm')}>
            記一筆
          </Link>
        </div>
      </Card>

      {/* 該注意的 */}
      {needsAttention.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">該處理的</h2>
          <div className="space-y-2">
            {needsAttention.map((d) => (
              <DueCard key={d.categoryId} due={d} deviceId={deviceId} />
            ))}
          </div>
        </section>
      )}

      {/* 尚未設定起算日 —— 必須顯示並附一鍵設定，絕不編一個假的到期日 */}
      {unset.length > 0 && (
        <Card className="border-warning/40 bg-warning/5 px-4 py-3.5">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-warning">
            <CircleHelp className="size-4" aria-hidden />
            {unset.length} 個種類算不出到期日
          </h2>
          <ul className="mt-1.5 space-y-0.5">
            {unset.map((d) => (
              <li key={d.categoryId} className="flex items-center gap-2 text-sm">
                <ColorDot color={d.color} />
                {d.name}
                <span className="text-xs text-muted-foreground">
                  {d.due.basis === 'NONE' ? '沒有起算日' : '沒設週期'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            系統不會替你編一個到期日 —— 錯的到期日比沒有到期日更糟。
            記一次更換、或到設定裡填「起算日」與「更換週期」就會開始算。
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Link
              href={devicePath(deviceId, 'consumables')}
              className={buttonClass('primary', 'sm')}
            >
              記一次更換
            </Link>
            <Link href={`/settings/devices/${deviceId}`} className={buttonClass('secondary', 'sm')}>
              去設定起算日
            </Link>
          </div>
        </Card>
      )}

      {/* 全部種類 */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">所有種類</h2>
        <Card>
          {sorted.map((d) => (
            <div
              key={d.categoryId}
              className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <ColorDot color={d.color} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{d.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {d.due.dueOn ? `${fmtZh(d.due.dueOn)} · ${basisLabel(d.due.basis)}` : basisLabel(d.due.basis)}
                </span>
              </span>
              <StatusBadge due={d} />
              <span className={cn('tabular w-12 shrink-0 text-right text-xs', d.stock < 0 && 'text-warning')}>
                庫存 {d.stock}
              </span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  )
}

function StatusBadge({ due: d }: { due: CategoryDue }) {
  switch (d.status) {
    case 'OVERDUE':
      return <Badge tone="danger">逾期 {Math.abs(d.due.daysLeft!)} 天</Badge>
    case 'SOON':
      return <Badge tone="warning">{d.due.daysLeft === 0 ? '今天' : `${d.due.daysLeft} 天`}</Badge>
    case 'PURCHASED':
      return <Badge tone="accent">待更換</Badge>
    case 'UNSET':
      return <Badge tone="muted">—</Badge>
    case 'OK':
      return <Badge tone="success">{d.due.daysLeft} 天</Badge>
  }
}

function DueCard({ due: d, deviceId }: { due: CategoryDue; deviceId: number }) {
  const tone =
    d.status === 'OVERDUE'
      ? 'border-destructive/40 bg-destructive/5'
      : d.status === 'SOON'
        ? 'border-warning/40 bg-warning/5'
        : 'border-border'

  const Icon =
    d.status === 'OVERDUE' ? AlertTriangle : d.status === 'SOON' ? CalendarClock : PackageCheck

  return (
    <Card className={cn('flex items-center gap-3 px-4 py-3', tone)}>
      <Icon
        aria-hidden
        className={cn(
          'size-5 shrink-0',
          d.status === 'OVERDUE' ? 'text-destructive' : d.status === 'SOON' ? 'text-warning' : 'text-primary',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <ColorDot color={d.color} />
          <span className="text-sm font-medium">{d.name}</span>
          <StatusBadge due={d} />
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {d.status === 'PURCHASED'
            ? `庫存 ${d.stock}，但還沒有更換紀錄 —— 該裝上去了`
            : `預計 ${fmtZh(d.due.dueOn!)} · ${basisLabel(d.due.basis)}`}
          {d.stock <= 0 && d.status !== 'PURCHASED' && ' · 庫存不足，記得先買'}
        </p>
      </div>
      <Link
        href={devicePath(deviceId, 'consumables')}
        className={buttonClass('secondary', 'sm', 'shrink-0')}
      >
        記錄
      </Link>
    </Card>
  )
}
