'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui'

/**
 * 上移／下移。
 *
 * 刻意不用拖曳排序：手機上長按拖曳與頁面捲動會互相搶手勢，
 * 而這份清單一輩子也就三五筆，兩個按鈕反而更快也更不會出錯。
 *
 * 送出的是**整份新順序**而不是「把這筆往上一格」—— 後者在兩個分頁
 * 同時操作時會依到達順序產生不同結果，整份順序則是幂等的。
 */
export function ReorderButtons({
  index,
  total,
  pending,
  onMove,
}: {
  index: number
  total: number
  pending?: boolean
  onMove: (from: number, to: number) => void
}) {
  return (
    <span className="flex shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="上移"
        disabled={pending || index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        <ChevronUp className="size-4" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="下移"
        disabled={pending || index === total - 1}
        onClick={() => onMove(index, index + 1)}
      >
        <ChevronDown className="size-4" aria-hidden />
      </Button>
    </span>
  )
}
