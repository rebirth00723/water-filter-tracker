'use client'

import { Button } from '@/components/ui'

/**
 * 表單的送出區。抽出來的理由是**按鈕順序與 pending 行為必須一致** ——
 * 有些畫面把「取消」放左邊、有些放右邊，使用者就得每次重新找。
 *
 * 送出中把兩個按鈕都停用：只停用送出鈕的話，使用者還能在寫入進行中按取消
 * 關掉抽屜，然後看不到結果。
 */
export function FormActions({
  pending,
  submitLabel = '儲存',
  pendingLabel = '儲存中…',
  onCancel,
}: {
  pending: boolean
  submitLabel?: string
  pendingLabel?: string
  onCancel?: () => void
}) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-6 flex gap-2 border-t border-border bg-card px-5 py-3">
      {onCancel && (
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending} className="flex-1">
          取消
        </Button>
      )}
      <Button type="submit" disabled={pending} className="flex-1">
        {pending ? pendingLabel : submitLabel}
      </Button>
    </div>
  )
}

/** 伺服端錯誤的顯示位置：緊貼在送出鈕上方，不必往上捲就看得到 */
export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}
