'use client'

import { Package, Pencil, Plus, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useAction } from 'next-safe-action/hooks'
import { toast } from 'sonner'
import { removeEvent } from '@/app/(app)/d/[deviceId]/consumables/actions'
import { actionErrorMessage } from '@/components/forms/action-feedback'
import { ConfirmButton } from '@/components/forms/ConfirmButton'
import { Badge, Button, Card, ColorDot, EmptyState } from '@/components/ui'
import { Drawer } from '@/components/ui/Drawer'
import { fmtZh } from '@/lib/date'
import type { EventType } from '@/lib/db/schema'
import type { EventRow } from '@/lib/events-store'
import { EventForm, type EventFormTemplate } from './EventForm'
import type { PickerCategory } from '@/lib/picker-data'

/**
 * 事件型別的徽章。
 *
 * **用 Record 而不是三元鏈。** 原本寫的是 `isReplace ? '更換' : '新購'`，
 * 於是 ADJUST 掉進 else 被標成「新購」，旁邊再補一個「盤點調整」——
 * 同一筆紀錄上出現兩個互相矛盾的標籤。
 * 這個表以 EventType 為索引，日後多一種型別會是編譯錯誤而不是預設值。
 */
const TYPE_BADGE: Record<EventType, { label: string; tone: 'accent' | 'muted' | 'warning' }> = {
  REPLACE: { label: '更換', tone: 'accent' },
  PURCHASE: { label: '新購', tone: 'muted' },
  ADJUST: { label: '盤點', tone: 'warning' },
}

export function EventList({
  deviceId,
  events,
  categories,
  templates,
  today,
}: {
  deviceId: number
  events: EventRow[]
  categories: PickerCategory[]
  templates: EventFormTemplate[]
  today: string
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<EventRow | null>(null)

  const del = useAction(removeEvent, {
    onSuccess: ({ data }) =>
      toast.success(
        `已刪除 ${fmtZh(data.occurredOn)} 的紀錄` + (data.hadReading ? '，當天的水質紀錄也一併移除' : ''),
      ),
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  const canRecord = categories.length > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          更換會成為下次到期日的起算點；新購只計入庫存與成本。
        </p>
        <Button
          size="sm"
          className="shrink-0 whitespace-nowrap"
          disabled={!canRecord}
          onClick={() => setAdding(true)}
        >
          <Plus className="size-4" aria-hidden />
          記一筆
        </Button>
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="還沒有耗材紀錄"
          description={
            canRecord
              ? '記下一次更換之後，系統就能算出每個種類的下次更換日，並在接近時推播提醒。'
              : '這台設備還沒有種類與耗材，先去設定裡建立，才能記錄更換。'
          }
        />
      ) : (
        <ul className="space-y-3">
          {events.map((ev) => {
            const isReplace = ev.type === 'REPLACE'
            return (
              // 深連結目標：水質紀錄頁的「前往更換紀錄」會跳到這裡
              <li key={ev.id} id={`event-${ev.id}`} className="scroll-mt-20">
                <Card className="px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"
                    >
                      {isReplace ? (
                        <Wrench className="size-4" />
                      ) : (
                        <Package className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{fmtZh(ev.occurredOn)}</span>
                        <Badge tone={TYPE_BADGE[ev.type].tone}>{TYPE_BADGE[ev.type].label}</Badge>
                        {ev.type === 'PURCHASE' && ev.total > 0 && (
                          <Badge tone="muted">
                            <span className="tabular">${ev.total}</span>
                          </Badge>
                        )}
                      </div>

                      <ul className="mt-1.5 space-y-0.5">
                        {ev.lines.map((l) => (
                          <li key={l.id} className="flex items-center gap-2 text-sm">
                            <ColorDot color={l.categoryColor} />
                            <span className="min-w-0 truncate">{l.itemName}</span>
                            <span className="tabular text-xs text-muted-foreground">×{l.qty}</span>
                            {l.unitPrice != null && (
                              <span className="tabular text-xs text-muted-foreground">
                                ${l.unitPrice}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>

                      {ev.reading && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          當天水質：原水{' '}
                          <span className="tabular" style={{ color: 'var(--chart-raw)' }}>
                            {ev.reading.rawPpm}
                          </span>{' '}
                          / 純水{' '}
                          <span className="tabular" style={{ color: 'var(--chart-pure)' }}>
                            {ev.reading.purePpm}
                          </span>{' '}
                          ppm
                        </p>
                      )}
                      {ev.vendor && (
                        <p className="mt-1 text-xs text-muted-foreground">在 {ev.vendor} 買</p>
                      )}
                      {ev.note && (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {ev.note}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {/*
                        ADJUST（盤點調整）的編輯介面刻意還沒做（見計畫的「刻意延後」）。
                        而這個表單只有「更換／新購」兩個選項，
                        所以讓 ADJUST 進到編輯畫面會把它**靜默轉成 REPLACE** ——
                        庫存反向、到期起算日被重設，而使用者只是想改個備註。
                        擋在這裡，直到 ADJUST 有自己的表單為止。
                      */}
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={ev.type === 'ADJUST'}
                        title={ev.type === 'ADJUST' ? '盤點調整的編輯介面尚未實作' : undefined}
                        aria-label={`編輯 ${ev.occurredOn} 的紀錄`}
                        onClick={() => setEditing(ev)}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <ConfirmButton
                        label="刪除"
                        variant="ghost"
                        title={`刪除 ${fmtZh(ev.occurredOn)} 的${TYPE_BADGE[ev.type].label}紀錄？`}
                        description={
                          <>
                            會移除 {ev.lines.length} 項明細
                            {ev.reading && '，以及當天那筆水質紀錄'}。
                            {isReplace && '刪除後這個種類的下次更換日會退回更早的起算點。'}
                            這個操作無法復原。
                          </>
                        }
                        pending={del.isPending}
                        onConfirm={() => del.execute({ id: ev.id })}
                      />
                    </div>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <Drawer open={adding} onOpenChange={setAdding} title="記一筆">
        <EventForm
          deviceId={deviceId}
          categories={categories}
          templates={templates}
          today={today}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      </Drawer>

      <Drawer
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title="編輯紀錄"
      >
        {editing && (
          <EventForm
            deviceId={deviceId}
            event={editing}
            categories={categories}
            templates={templates}
            today={today}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Drawer>
    </div>
  )
}
