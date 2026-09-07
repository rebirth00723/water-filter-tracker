'use client'

import { X } from 'lucide-react'
import { Drawer as Vaul } from 'vaul'
import { cn } from '@/lib/utils'

/**
 * 底部抽屜。手機上比對話框好：從下緣升起、拇指按得到，
 * 而且可以往下滑關閉，不必去點右上角那個小叉。
 *
 * `repositionInputs` 預設會在鍵盤升起時挪動內容 —— 這個 App 的抽屜幾乎都有輸入框，
 * 關掉它會讓欄位被鍵盤蓋住。
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Vaul.Root open={open} onOpenChange={onOpenChange} repositionInputs>
      <Vaul.Portal>
        <Vaul.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Vaul.Content
          /*
           * 沒有 description 時明確關掉 aria-describedby。
           * 先前為了消掉 Radix「缺少 Description」的開發警告，塞了一個 sr-only 的
           * Description 重複標題 —— 結果是螢幕閱讀器把標題念兩次。
           * 為了消一個開發模式的警告而製造一個真實的無障礙缺陷，划不來。
           *
           * 有 description 時什麼都不覆寫：那時 aria-describedby 由 Radix 自己接。
           */
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col',
            'rounded-t-2xl border-t border-border bg-card outline-none',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-2">
            <div className="min-w-0 flex-1">
              <Vaul.Handle className="mx-auto mb-3 !h-1.5 !w-10 !bg-border" />
              <Vaul.Title className="text-base font-semibold">{title}</Vaul.Title>
              {description && (
                <Vaul.Description className="mt-1 text-xs text-muted-foreground">
                  {description}
                </Vaul.Description>
              )}
            </div>
            <Vaul.Close
              aria-label="關閉"
              className="mt-6 -mr-1 rounded-md p-2 text-muted-foreground hover:bg-muted"
            >
              <X className="size-5" />
            </Vaul.Close>
          </div>
          {/* pb 留 safe area：iPhone 上抽屜底部會壓在 home indicator 上 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </Vaul.Content>
      </Vaul.Portal>
    </Vaul.Root>
  )
}
