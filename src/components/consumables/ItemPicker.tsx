'use client'

import { ArrowLeft, Plus } from 'lucide-react'
import { useState } from 'react'
import { ItemForm } from '@/components/forms/ItemForm'
import { Badge, Button, ColorDot, EmptyState } from '@/components/ui'
import { Drawer } from '@/components/ui/Drawer'
import { cn } from '@/lib/utils'
import type { PickerCategory, PickerItem } from '@/lib/picker-data'

/**
 * 兩階抽屜挑選器，取代兩層下拉。
 *
 * 第一階列出啟用中的種類，帶顏色、庫存與逾期天數（逾期標紅）——
 * **這讓挑選器本身直接變成待辦清單**：使用者一打開就看到「第一道已逾期 12 天」，
 * 不必先去首頁看一遍再回來選。
 *
 * **種類底下只有一個耗材時直接跳過第二階。** 多數人每個位置就用一種濾心，
 * 所以絕大部分情況只要一次點擊。
 */
export function ItemPicker({
  categories,
  open,
  onOpenChange,
  onPick,
}: {
  categories: PickerCategory[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (item: { itemId: number; categoryId: number; qty: number; name: string }) => void
}) {
  const [stage, setStage] = useState<PickerCategory | null>(null)
  const [creating, setCreating] = useState(false)

  const close = () => {
    onOpenChange(false)
    // 下次打開回到第一階。留在第二階會讓人以為挑選器壞了
    setStage(null)
    setCreating(false)
  }

  function pick(cat: PickerCategory, item: PickerItem) {
    onPick({ itemId: item.id, categoryId: cat.id, qty: item.defaultQty, name: item.name })
    close()
  }

  function chooseCategory(cat: PickerCategory) {
    const active = cat.items
    if (active.length === 1) return pick(cat, active[0])
    setStage(cat)
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={stage ? stage.name : '加入耗材'}
      description={stage ? undefined : '逾期的排在最前面'}
    >
      {stage === null ? (
        <ul className="pb-2">
          {categories.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => chooseCategory(c)}
                className="flex min-h-14 w-full items-center gap-3 border-b border-border px-1 py-2 text-left last:border-b-0"
              >
                <ColorDot color={c.color} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <Badge
                      tone={
                        c.overdueDays !== null
                          ? 'danger'
                          : c.daysLeft !== null && c.daysLeft <= 14
                            ? 'warning'
                            : 'muted'
                      }
                    >
                      {c.statusLabel}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    庫存{' '}
                    <span className={cn('tabular', c.stock < 0 && 'text-warning')}>{c.stock}</span>
                    {c.items.length === 0 && ' · 這個種類還沒有耗材'}
                    {c.items.length > 1 && ` · ${c.items.length} 種可選`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="pb-2">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => setStage(null)}>
            <ArrowLeft className="size-4" aria-hidden />
            所有種類
          </Button>

          {stage.items.length === 0 ? (
            /*
             * 系統預設不帶任何耗材品項，所以**每個使用者的第一次更換都會走到這裡**。
             * 如果強迫跳去設定頁再回來，初次體驗就毀了 —— 就地新增並立刻選用。
             */
            <EmptyState
              title={`「${stage.name}」還沒有耗材`}
              description="現在新增一項就能直接選用，不必跳去設定頁再回來。"
              action={<Button onClick={() => setCreating(true)}>新增耗材</Button>}
            />
          ) : (
            <ul>
              {stage.items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => pick(stage, it)}
                    className="flex min-h-14 w-full items-center gap-3 border-b border-border px-1 py-2 text-left last:border-b-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm">{it.name}</span>
                        {it.defaultQty > 1 && <Badge tone="muted">預設 ×{it.defaultQty}</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {[
                          it.brand,
                          `庫存 ${it.stock}`,
                          it.lastPurchaseLabel,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {stage.items.length > 0 && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              新增耗材到「{stage.name}」
            </Button>
          )}

          <Drawer
            open={creating}
            onOpenChange={setCreating}
            title={`新增耗材到「${stage.name}」`}
          >
            <ItemForm
              categoryId={stage.id}
              onCreated={(created) => {
                /*
                 * 就地新增之後立刻選用它 —— 這是這條路徑存在的全部理由。
                 *
                 * 數量用剛存下的 `defaultQty`，與上面 `pick()` 走既有耗材時一致。
                 * 這裡原本寫死 1：使用者在更換表單裡新增耗材、填了預設數量 3，
                 * 帶進清單的卻是 1，而從挑選器選既有耗材時又是對的 ——
                 * 於是症狀變成「有時候有效、有時候沒效」。
                 */
                onPick({
                  itemId: created.id,
                  categoryId: created.categoryId,
                  qty: created.defaultQty,
                  name: created.name,
                })
                close()
              }}
              onCancel={() => setCreating(false)}
            />
          </Drawer>
        </div>
      )}
    </Drawer>
  )
}
