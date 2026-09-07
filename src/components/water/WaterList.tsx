'use client'

import { ArrowRight, Pencil, Plus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useAction } from 'next-safe-action/hooks'
import { toast } from 'sonner'
import { removeReading } from '@/app/(app)/d/[deviceId]/water/actions'
import { actionErrorMessage } from '@/components/forms/action-feedback'
import { ConfirmButton } from '@/components/forms/ConfirmButton'
import { ReadingForm } from '@/components/forms/ReadingForm'
import { Badge, Button, Card, EmptyState } from '@/components/ui'
import { Drawer } from '@/components/ui/Drawer'
import { fmtZh } from '@/lib/date'
import { devicePath } from '@/lib/device-path'
import { rejectionRate } from '@/lib/ppm'
import type { ReadingRow } from '@/lib/readings-store'

export function WaterList({
  deviceId,
  rows,
  today,
}: {
  deviceId: number
  rows: ReadingRow[]
  today: string
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ReadingRow | null>(null)

  const del = useAction(removeReading, {
    onSuccess: ({ data }) => toast.success(`已刪除 ${fmtZh(data.measuredOn)} 的紀錄`),
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  return (
    <div className="space-y-4">
      {/*
        新增用內嵌的卡片而不是抽屜：這是這一頁最常做的事，
        少一次點擊就是少一次點擊。抽屜留給編輯。
      */}
      <Card className="px-4 py-3.5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">記一筆</h2>
          {!adding && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              展開
            </Button>
          )}
        </div>
        {adding ? (
          <ReadingForm
            deviceId={deviceId}
            today={today}
            compact
            onCancel={() => setAdding(false)}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            量完原水與純水就記一筆。連續補登好幾天時，記錄後日期會留著不清空。
          </p>
        )}
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title="還沒有水質紀錄"
          description="兩個數字就夠了：原水與純水的 TDS 讀數。累積幾筆之後，報表會把它們和濾心更換疊在同一條時間軸上，濾心衰退就看得出來。"
          action={!adding && <Button onClick={() => setAdding(true)}>記第一筆</Button>}
        />
      ) : (
        <Card>
          <ul>
            {rows.map((r) => {
              const rate = rejectionRate(r.rawPpm, r.purePpm)
              const fromEvent = r.eventId !== null
              return (
                <li
                  key={r.id}
                  className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{fmtZh(r.measuredOn)}</span>
                      {fromEvent && <Badge tone="accent">來自更換紀錄</Badge>}
                    </div>
                    <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                      <span>
                        <span className="text-xs text-muted-foreground">原水 </span>
                        <strong className="tabular" style={{ color: 'var(--chart-raw)' }}>
                          {r.rawPpm}
                        </strong>
                      </span>
                      <span>
                        <span className="text-xs text-muted-foreground">純水 </span>
                        <strong className="tabular" style={{ color: 'var(--chart-pure)' }}>
                          {r.purePpm}
                        </strong>
                      </span>
                      {rate !== null && (
                        <span className="text-xs text-muted-foreground">
                          去除率 <span className="tabular">{rate.toFixed(1)}%</span>
                        </span>
                      )}
                    </p>
                    {r.note && (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.note}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`編輯 ${r.measuredOn} 的紀錄`}
                      onClick={() => setEditing(r)}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    {fromEvent ? (
                      /*
                       * 事件擁有的紀錄不提供刪除，改成連到那筆更換紀錄 ——
                       * 給一個按了一定會失敗的刪除鈕，比不給更糟。
                       */
                      <Link
                        href={`${devicePath(deviceId, 'consumables')}#event-${r.eventId}`}
                        aria-label="前往該筆更換紀錄"
                        className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted"
                      >
                        更換紀錄
                        <ArrowRight className="size-3.5" aria-hidden />
                      </Link>
                    ) : (
                      <ConfirmButton
                        label="刪除"
                        variant="ghost"
                        title={`刪除 ${fmtZh(r.measuredOn)} 的水質紀錄？`}
                        description={
                          <>
                            原水 {r.rawPpm} / 純水 {r.purePpm} ppm。
                            刪除後報表上對應的那個點會消失，這個操作無法復原。
                          </>
                        }
                        pending={del.isPending}
                        onConfirm={() => del.execute({ id: r.id })}
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <Drawer
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title="編輯水質紀錄"
        description={
          editing?.eventId != null
            ? `這筆來自 ${editing.eventOccurredOn ?? ''} 的更換紀錄，只能改數值`
            : undefined
        }
      >
        {editing && (
          <ReadingForm
            deviceId={deviceId}
            reading={editing}
            today={today}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Drawer>
    </div>
  )
}
