'use client'

import { Toaster as Sonner } from 'sonner'

/**
 * 全域的 toast 容器。
 *
 * `position="top-center"`：手機底部有導覽列與 safe area，
 * toast 放下面會被蓋住或撞到 home indicator。
 */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        classNames: {
          toast: 'rounded-lg border border-border bg-card text-card-foreground shadow-lg',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          error: 'border-destructive/40',
        },
      }}
    />
  )
}
