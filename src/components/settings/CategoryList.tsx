'use client'

import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { useAction } from 'next-safe-action/hooks'
import { toast } from 'sonner'
import {
  removeCategory,
  removeItem,
  sortCategories,
} from '@/app/(app)/settings/devices/actions'
import { actionErrorMessage } from '@/components/forms/action-feedback'
import { CategoryForm } from '@/components/forms/CategoryForm'
import { ConfirmButton } from '@/components/forms/ConfirmButton'
import { ItemForm } from '@/components/forms/ItemForm'
import { Badge, Button, Card, ColorDot, EmptyState } from '@/components/ui'
import { Drawer } from '@/components/ui/Drawer'
import type { Category, Item } from '@/lib/settings-store'
import { ReorderButtons } from './ReorderButtons'

export interface CategoryListData {
  deviceId: number
  categories: Category[]
  itemsByCategory: Record<number, Item[]>
  /** 該種類出現在幾筆歷史紀錄裡。>0 就不能刪，只能停用 */
  categoryUsage: Record<number, number>
  itemUsage: Record<number, number>
}

type Editing =
  | { kind: 'category'; category?: Category }
  | { kind: 'item'; categoryId: number; item?: Item }
  | null

function cycleLabel(c: Category): string {
  if (c.cyclePeriod === null) return '未設週期'
  return `每 ${c.cyclePeriod} ${c.cycleUnit === 'MONTH' ? '個月' : '天'}`
}

export function CategoryList({
  deviceId,
  categories,
  itemsByCategory,
  categoryUsage,
  itemUsage,
}: CategoryListData) {
  const [editing, setEditing] = useState<Editing>(null)
  const close = () => setEditing(null)

  const onError = ({ error }: { error: Parameters<typeof actionErrorMessage>[0] }) =>
    toast.error(actionErrorMessage(error))

  const delCategory = useAction(removeCategory, {
    onSuccess: ({ data }) =>
      toast.success(
        data.cascadedItems > 0
          ? `已刪除「${data.name}」與底下 ${data.cascadedItems} 項耗材`
          : `已刪除「${data.name}」`,
      ),
    onError,
  })
  const delItem = useAction(removeItem, {
    onSuccess: ({ data }) => toast.success(`已刪除「${data.name}」`),
    onError,
  })
  const reorder = useAction(sortCategories, { onError })

  return (
    <section>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">種類與耗材</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            種類決定到期提醒與泳道；耗材是實際會買的品項。順序就是報表上泳道的順序
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing({ kind: 'category' })}>
          <Plus className="size-4" aria-hidden />
          種類
        </Button>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          title="還沒有任何種類"
          description="種類是「第一道」「RO」這種濾心的位置。到期提醒與報表泳道都以種類為單位。"
          action={<Button onClick={() => setEditing({ kind: 'category' })}>新增第一個種類</Button>}
        />
      ) : (
        <div className="space-y-3">
          {categories.map((c, i) => {
            const items = itemsByCategory[c.id] ?? []
            const used = categoryUsage[c.id] ?? 0

            return (
              <Card key={c.id} className="overflow-hidden">
                <div className="flex items-start gap-2 px-4 py-3">
                  <ColorDot color={c.color} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{c.name}</span>
                      {!c.active && <Badge tone="muted">停用</Badge>}
                      {!c.notifyEnabled && <Badge tone="muted">不提醒</Badge>}
                      <Badge tone={c.cyclePeriod === null ? 'warning' : 'muted'}>
                        {cycleLabel(c)}
                      </Badge>
                      {used > 0 && <Badge tone="accent">{used} 筆紀錄</Badge>}
                    </div>
                  </div>
                  <ReorderButtons
                    index={i}
                    total={categories.length}
                    pending={reorder.isPending}
                    onMove={(from, to) => {
                      const ids = categories.map((x) => x.id)
                      const [moved] = ids.splice(from, 1)
                      ids.splice(to, 0, moved)
                      reorder.execute({ deviceId, ids })
                    }}
                  />
                </div>

                {/* 耗材 */}
                <div className="border-t border-border bg-muted/30 px-4 py-2.5">
                  {items.length === 0 ? (
                    <p className="py-1 text-xs text-muted-foreground">
                      這個種類底下還沒有耗材。沒有耗材就無法記錄更換。
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {items.map((it) => {
                        const itUsed = itemUsage[it.id] ?? 0
                        return (
                          <li key={it.id} className="flex items-center gap-2 py-2">
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate text-sm">{it.name}</span>
                                {!it.active && <Badge tone="muted">停用</Badge>}
                                {it.defaultQty > 1 && (
                                  <Badge tone="muted">預設 ×{it.defaultQty}</Badge>
                                )}
                              </span>
                              {it.brand && (
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                  {it.brand}
                                </span>
                              )}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`編輯 ${it.name}`}
                              onClick={() =>
                                setEditing({ kind: 'item', categoryId: c.id, item: it })
                              }
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                            <ConfirmButton
                              label="刪除"
                              title={`刪除耗材「${it.name}」？`}
                              description={
                                itUsed > 0 ? (
                                  <>
                                    這項耗材已經出現在 <strong>{itUsed} 筆</strong>紀錄裡，
                                    因此<strong>無法刪除</strong> —— 刪了那些紀錄會失去它們的耗材。
                                    請改為在編輯裡取消「啟用中」，它就不再出現在挑選器。
                                  </>
                                ) : (
                                  <>這項耗材還沒有任何紀錄，可以安全刪除。</>
                                )
                              }
                              pending={delItem.isPending}
                              onConfirm={() => delItem.execute({ id: it.id })}
                            />
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing({ kind: 'item', categoryId: c.id })}
                    >
                      <Plus className="size-4" aria-hidden />
                      新增耗材
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing({ kind: 'category', category: c })}
                    >
                      編輯種類
                    </Button>
                    <ConfirmButton
                      label="刪除種類"
                      variant="ghost"
                      title={`刪除種類「${c.name}」？`}
                      description={
                        used > 0 ? (
                          <>
                            這個種類已經出現在 <strong>{used} 筆</strong>紀錄裡，
                            因此<strong>無法刪除</strong>。請改為取消「啟用中」，
                            它就不再出現在挑選器與報表泳道，但歷史紀錄完整保留。
                          </>
                        ) : items.length > 0 ? (
                          <>
                            會連帶刪除底下 <strong>{items.length} 項耗材</strong>
                            （{items.map((i) => i.name).join('、')}）。這些耗材都還沒有紀錄，
                            所以刪除不會影響任何歷史資料。
                          </>
                        ) : (
                          <>這個種類底下沒有耗材、也沒有紀錄，可以安全刪除。</>
                        )
                      }
                      pending={delCategory.isPending}
                      onConfirm={() => delCategory.execute({ id: c.id })}
                    />
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Drawer
        open={editing?.kind === 'category'}
        onOpenChange={(o) => !o && close()}
        title={editing?.kind === 'category' && editing.category ? '編輯種類' : '新增種類'}
      >
        {editing?.kind === 'category' && (
          <CategoryForm
            deviceId={deviceId}
            category={editing.category}
            onDone={close}
            onCancel={close}
          />
        )}
      </Drawer>

      <Drawer
        open={editing?.kind === 'item'}
        onOpenChange={(o) => !o && close()}
        title={editing?.kind === 'item' && editing.item ? '編輯耗材' : '新增耗材'}
      >
        {editing?.kind === 'item' && (
          <ItemForm
            categoryId={editing.categoryId}
            item={editing.item}
            onDone={close}
            onCancel={close}
          />
        )}
      </Drawer>
    </section>
  )
}
