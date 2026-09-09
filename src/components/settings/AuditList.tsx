'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Badge, Card, EmptyState } from '@/components/ui'
import { AUDIT_GROUPS, UNGROUPED_LABEL, type AuditGroup } from '@/lib/audit-groups'
import { cn } from '@/lib/utils'

export interface AuditItem {
  id: number
  /**
   * 伺服端依 App 時區格式化好的時間字串。
   *
   * 刻意不傳 epoch ms 讓客戶端自己轉 —— 客戶端讀不到 `TZ`，
   * 轉出來會是瀏覽器的時區，而伺服端渲染的 HTML 用的是 App 時區，
   * 兩者不一致就是 hydration 錯誤加上錯的時間。
   */
  atLabel: string
  username: string | null
  ip: string | null
  userAgent: string | null
  action: string
  entity: string | null
  entityId: number | null
  summary: string
  before: string | null
  after: string | null
  group: AuditGroup | null
}

const TONE: Record<AuditGroup, 'muted' | 'warning' | 'danger' | 'success' | 'accent'> = {
  login: 'accent',
  event: 'muted',
  reading: 'muted',
  config: 'muted',
  data: 'warning',
  notify: 'muted',
}

export function AuditList({
  items,
  total,
  page,
  pageSize,
  group,
  from,
  to,
  keepDays,
}: {
  items: AuditItem[]
  total: number
  page: number
  pageSize: number
  group?: AuditGroup
  from?: string
  to?: string
  keepDays: string
}) {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = { group, from, to, page: String(page), ...over }
    for (const [k, v] of Object.entries(merged)) {
      if (v && !(k === 'page' && v === '1')) p.set(k, v)
    }
    return p.size ? `?${p}` : '?'
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      {/* 篩選：用連結而不是 select + JS，這樣可加書籤也可分享 */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={qs({ group: undefined, page: '1' })}
          className={cn(
            'h-9 rounded-full border px-3 text-xs font-medium leading-9',
            !group ? 'border-primary bg-accent text-accent-foreground' : 'border-input',
          )}
        >
          全部
        </Link>
        {(Object.entries(AUDIT_GROUPS) as [AuditGroup, { label: string }][]).map(([k, g]) => (
          <Link
            key={k}
            href={qs({ group: k, page: '1' })}
            className={cn(
              'h-9 rounded-full border px-3 text-xs font-medium leading-9',
              group === k ? 'border-primary bg-accent text-accent-foreground' : 'border-input',
            )}
          >
            {g.label}
          </Link>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        共 <span className="tabular">{total}</span> 筆
        {total > pageSize && `（第 ${page} / ${lastPage} 頁）`} · 保留 {keepDays} 天，
        每天凌晨自動清理超過期限的紀錄
      </p>

      {items.length === 0 ? (
        <EmptyState
          title="沒有符合條件的紀錄"
          description="操作紀錄會記下每一次登入、資料異動與設定變更，並保留變更前後的值。"
        />
      ) : (
        <Card>
          <ul>
            {items.map((it) => {
              const expanded = open.has(it.id)
              const hasDetail = it.before !== null || it.after !== null
              return (
                <li key={it.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    disabled={!hasDetail}
                    aria-expanded={hasDetail ? expanded : undefined}
                    onClick={() => hasDetail && toggle(it.id)}
                    className={cn(
                      'flex min-h-14 w-full items-start gap-2.5 px-4 py-3 text-left',
                      hasDetail && 'hover:bg-muted',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        {/* 未分類的（舊資料）也要有徽章，空白會讓那一列看起來像壞掉 */}
                        <Badge tone={it.group ? TONE[it.group] : 'muted'}>
                          {it.group ? AUDIT_GROUPS[it.group].label : UNGROUPED_LABEL}
                        </Badge>
                        <span className="text-sm">{it.summary}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {it.atLabel}
                        {it.username && ` · ${it.username}`}
                        {it.ip && it.ip !== 'unknown' && ` · ${it.ip}`}
                        {' · '}
                        <code className="font-mono">{it.action}</code>
                      </span>
                    </span>
                    {hasDetail &&
                      (expanded ? (
                        <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      ) : (
                        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      ))}
                  </button>

                  {expanded && (
                    <div className="space-y-2 bg-muted/30 px-4 pb-3">
                      {/*
                        變更前後值是這張表真正的價值：誤刪的紀錄可以照著
                        「變更前」手動補回。所以要能看到原始 JSON，
                        而不是一句「某人刪了某筆」。
                      */}
                      {it.before && (
                        <div>
                          <p className="text-xs font-medium">變更前</p>
                          <pre className="mt-0.5 overflow-x-auto rounded-md bg-background px-2.5 py-2 text-xs">
                            {pretty(it.before)}
                          </pre>
                        </div>
                      )}
                      {it.after && (
                        <div>
                          <p className="text-xs font-medium">變更後</p>
                          <pre className="mt-0.5 overflow-x-auto rounded-md bg-background px-2.5 py-2 text-xs">
                            {pretty(it.after)}
                          </pre>
                        </div>
                      )}
                      {it.userAgent && (
                        <p className="text-xs break-all text-muted-foreground">{it.userAgent}</p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-between gap-2">
          <Link
            href={qs({ page: String(Math.max(1, page - 1)) })}
            aria-disabled={page <= 1}
            className={cn(
              'h-11 rounded-md border border-input px-4 text-sm leading-[2.75rem]',
              page <= 1 && 'pointer-events-none opacity-40',
            )}
          >
            上一頁
          </Link>
          <span className="tabular text-xs text-muted-foreground">
            {page} / {lastPage}
          </span>
          <Link
            href={qs({ page: String(Math.min(lastPage, page + 1)) })}
            aria-disabled={page >= lastPage}
            className={cn(
              'h-11 rounded-md border border-input px-4 text-sm leading-[2.75rem]',
              page >= lastPage && 'pointer-events-none opacity-40',
            )}
          >
            下一頁
          </Link>
        </div>
      )}
    </div>
  )
}

/** JSON 排版。壞掉的 JSON 原樣顯示而不是吞掉 —— 那是唯一還原資料的線索 */
function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}
