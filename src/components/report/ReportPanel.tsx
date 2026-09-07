'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import type { RangeKey, ReportData } from '@/lib/report-store'
import { ReportView } from './ReportView'

/**
 * 時間範圍放在網址的 query 而不是元件狀態。
 *
 * 好處是可以分享與加書籤（「看一下我這台的全部歷史」是一個連結就能傳的東西），
 * 而且重新載入頁面不會跳回預設的 12 個月。
 * 代價是每次切換要走一次伺服端渲染 —— 但這些頁面本來就是 force-dynamic，
 * 而在客戶端重算報表要把整份原始資料都送下來，那更貴。
 */
export function ReportPanel({ data, range }: { data: ReportData; range: RangeKey }) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  function setRange(next: RangeKey) {
    const q = new URLSearchParams(params.toString())
    if (next === '1y') q.delete('range')
    else q.set('range', next)
    startTransition(() => {
      router.replace(q.size ? `?${q}` : '?', { scroll: false })
    })
  }

  return (
    <div className={pending ? 'opacity-60 transition-opacity' : undefined}>
      <ReportView data={data} range={range} onRangeChange={setRange} />
    </div>
  )
}
