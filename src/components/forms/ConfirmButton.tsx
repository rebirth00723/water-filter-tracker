'use client'

import { useState } from 'react'
import { Button } from '@/components/ui'
import { Drawer } from '@/components/ui/Drawer'

/**
 * 破壞性操作的二次確認。
 *
 * 用抽屜而不是 `window.confirm`：原生對話框在手機上樣式不受控、**無法說明後果**，
 * 而這裡最需要的恰好是說明後果 —— 「刪除種類會連帶刪掉底下 3 項耗材」
 * 這種資訊塞不進一行 confirm 文字。
 *
 * 刻意不做 undo。設定頁的刪除會 cascade 到別的表，
 * 而 undo 要能還原 cascade 掉的東西才算真的能復原 —— 做不到就不該假裝有。
 * 更換紀錄那類單筆、可完整還原的操作才用 undo。
 */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel = '確定刪除',
  pending,
  onConfirm,
  variant = 'destructive',
  size = 'sm',
}: {
  label: React.ReactNode
  title: string
  description: React.ReactNode
  confirmLabel?: string
  pending?: boolean
  onConfirm: () => void
  variant?: 'destructive' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'icon'
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Drawer open={open} onOpenChange={setOpen} title={title}>
        <div className="space-y-4 pt-1">
          <div className="text-sm leading-relaxed text-muted-foreground">{description}</div>
          <div className="flex gap-2 pb-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              disabled={pending}
              onClick={() => {
                onConfirm()
                setOpen(false)
              }}
            >
              {pending ? '處理中…' : confirmLabel}
            </Button>
          </div>
        </div>
      </Drawer>
    </>
  )
}
