'use client'

import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 數量步進器，取代數字輸入框。
 *
 * 手機上數字鍵盤會蓋掉半個畫面、而且要按「完成」才收起來 ——
 * 而數量幾乎永遠是 1 或 2。兩個 44px 的按鈕比叫出鍵盤快得多。
 */
export function QtyStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  label: string
}) {
  return (
    <span className="inline-flex items-center rounded-md border border-input">
      <button
        type="button"
        aria-label={`${label} 減少`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className={cn(
          'flex size-11 items-center justify-center rounded-l-md outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        )}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span
        aria-live="polite"
        aria-label={`${label} 數量`}
        className="tabular w-8 text-center text-sm font-medium"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`${label} 增加`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className={cn(
          'flex size-11 items-center justify-center rounded-r-md outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        )}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </span>
  )
}
