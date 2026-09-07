'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 種類顏色。
 *
 * 預設色盤**刻意避開橘與藍** —— 報表主圖固定用橘＝原水、藍＝純水，
 * 種類的圓點如果也用這兩色，泳道與折線就會在視覺上混成一團。
 * 這是圖表可讀性的硬約束，不是美感偏好，所以寫在色盤裡而不是靠使用者自律。
 */
const PALETTE = [
  '#14b8a6', '#0891b2', '#8b5cf6', '#a855f7', '#9333ea',
  '#dc2626', '#e11d48', '#059669', '#65a30d', '#ca8a04',
  '#6b7280', '#0f766e',
] as const

export function ColorPicker({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (color: string) => void
  id?: string
}) {
  const normalized = value.toLowerCase()

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {PALETTE.map((c) => {
          const selected = normalized === c
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              aria-label={`選擇顏色 ${c}`}
              aria-pressed={selected}
              // 44px 觸控目標：色塊本身只有 28px，靠 padding 補到可靠的點擊面積
              className={cn(
                'flex size-11 items-center justify-center rounded-md outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'bg-muted' : 'hover:bg-muted',
              )}
            >
              <span
                className="flex size-7 items-center justify-center rounded-full"
                style={{ backgroundColor: c }}
              >
                {selected && <Check className="size-4 text-white drop-shadow" strokeWidth={3} />}
              </span>
            </button>
          )
        })}
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        自訂
        <input
          id={id}
          type="color"
          value={normalized}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-14 cursor-pointer rounded border border-input bg-background p-1"
        />
        <span className="font-mono">{normalized}</span>
      </label>
    </div>
  )
}
