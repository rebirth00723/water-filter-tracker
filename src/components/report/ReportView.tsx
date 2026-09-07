'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Badge, Card, ColorDot, EmptyState } from '@/components/ui'
import { fmtZh } from '@/lib/date'
import type { RangeKey, ReportData } from '@/lib/report-store'
import { cn } from '@/lib/utils'

/**
 * ECharts 必須 `ssr: false`：它在模組載入時就會碰 document。
 * 而 dynamic import 也讓約 300KB 的圖表程式只在真的看報表時才下載。
 */
const PpmChart = dynamic(() => import('./PpmChart').then((m) => m.PpmChart), {
  ssr: false,
  loading: () => (
    <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
      載入圖表…
    </div>
  ),
})

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '3m', label: '3 個月' },
  { key: '1y', label: '1 年' },
  { key: 'all', label: '全部' },
]

export function ReportView({
  data,
  range,
  onRangeChange,
}: {
  data: ReportData
  range: RangeKey
  onRangeChange: (r: RangeKey) => void
}) {
  /**
   * 圖例自己用 HTML 渲染而不用 ECharts 內建的。
   *
   * 三個理由：Tailwind 可以正確換行（內建的在窄螢幕會擠成一團）、
   * 色塊能給到 44px 的觸控目標、而「下次更換日」清單放在這裡
   * 比標在圖上易讀得多 —— 圖上標了六個日期就只剩一團字。
   */
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const toggle = (id: number) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const hasData = data.readings.length > 0 || data.lanes.some((l) => l.points.length > 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={range === r.key}
            onClick={() => onRangeChange(r.key)}
            className={cn(
              'h-9 rounded-full border px-3 text-xs font-medium',
              range === r.key ? 'border-primary bg-accent text-accent-foreground' : 'border-input',
            )}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {data.readings.length} 筆量測
        </span>
      </div>

      {!hasData ? (
        <EmptyState
          title="這段期間沒有資料"
          description={
            data.totalReadings === 0
              ? '記幾筆水質與一次更換之後，這張圖會把兩者疊在同一條時間軸上 —— 濾心衰退就是這樣看出來的。'
              : '換成「全部」看看，或先記幾筆新的量測。'
          }
        />
      ) : (
        <>
          <Card className="overflow-hidden px-1 py-2">
            <PpmChart data={data} hidden={hidden} />
          </Card>

          {/* 圖例 + 下次更換日 */}
          <Card className="px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-1.5 text-xs">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-4"
                  style={{ background: 'var(--chart-raw)' }}
                />
                原水
              </span>
              <span className="flex items-center gap-1.5 text-xs">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-4"
                  style={{ background: 'var(--chart-pure)' }}
                />
                純水
              </span>
            </div>

            <ul className="mt-2 divide-y divide-border">
              {data.lanes.map((lane) => {
                const off = hidden.has(lane.categoryId)
                return (
                  <li key={lane.categoryId}>
                    <button
                      type="button"
                      aria-pressed={!off}
                      onClick={() => toggle(lane.categoryId)}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-2.5 text-left',
                        off && 'opacity-40',
                      )}
                    >
                      <ColorDot color={lane.color} />
                      <span className="min-w-0 flex-1 truncate text-sm">{lane.name}</span>
                      <span className="tabular shrink-0 text-xs text-muted-foreground">
                        {lane.points.length} 次
                      </span>
                      {lane.dueOn ? (
                        <Badge tone={lane.overdue ? 'danger' : 'muted'}>
                          {lane.overdue ? '已逾期 ' : '下次 '}
                          {fmtZh(lane.dueOn)}
                        </Badge>
                      ) : (
                        <Badge tone="muted">未設到期日</Badge>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              點種類可以在圖上隱藏那一列。圖上點任何位置都會吸附到最近的日期，
              兩指可以縮放時間範圍。
            </p>
          </Card>
        </>
      )}

      {/* 成本 */}
      {data.cost.grandTotal > 0 && (
        <Card className="px-4 py-3.5">
          <h2 className="text-sm font-semibold">耗材支出</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            只計有填單價的新購紀錄。累計 <span className="tabular">${data.cost.grandTotal}</span>
          </p>

          <ul className="mt-2.5 space-y-1.5">
            {data.cost.byCategory.map((c) => (
              <li key={c.name} className="flex items-center gap-2.5 text-sm">
                <ColorDot color={c.color} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="tabular shrink-0">${c.total}</span>
                {c.monthlyAvg !== null && (
                  <span className="tabular w-24 shrink-0 text-right text-xs text-muted-foreground">
                    ${c.monthlyAvg.toFixed(0)}／月
                  </span>
                )}
              </li>
            ))}
          </ul>

          {data.cost.byYear.length > 1 && (
            <>
              <h3 className="mt-3 text-xs font-medium text-muted-foreground">年度</h3>
              <ul className="mt-1 space-y-0.5">
                {data.cost.byYear.map((y) => (
                  <li key={y.year} className="flex items-center gap-2 text-sm">
                    <span className="tabular w-12">{y.year}</span>
                    <span className="tabular">${y.total}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
