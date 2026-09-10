'use client'

import { Button, Card } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'

/**
 * 已登入區的錯誤邊界。
 *
 * 沒有這個檔案時，Server Component 丟出的錯誤會落到 Next 內建的錯誤頁：
 * 正式環境是一句英文的 "Application error: a server-side exception has occurred"，
 * 而且它自己渲染整份文件、讀不到這個 App 的樣式與主題。
 *
 * ## 為什麼顯示 digest
 *
 * 正式環境的 `error.message` 是被抹掉的（Next 刻意不把伺服端的錯誤內容送到
 * 瀏覽器，避免洩漏路徑或查詢內容），能對得上伺服器日誌的只有 `digest`。
 * 這個 App 的日誌是 JSON 走 stdout，所以畫面上把 digest 顯示出來，
 * 使用者回報時附上它，就能 `docker logs | grep <digest>` 直接找到那一筆。
 * 不顯示的話，自架的人手上就只有「壞了」兩個字。
 *
 * ## retry 而不是 reset
 *
 * 這個 Next 版本的錯誤邊界收到的是 `retry()`：它會**重新取資料再重繪**。
 * `reset()` 只清掉錯誤狀態、不重新取資料 —— 對「SQLite 當下被鎖住」
 * 這類暫時性錯誤沒有用，畫面會立刻再爆一次。
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <>
      <PageHeader title="出了點問題" />
      <div className="px-4 pb-6 pt-4">
        <Card className="space-y-4 p-4">
          <p className="text-sm leading-relaxed">
            這一頁載入失敗了。多半是暫時的，再試一次通常就好。
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground">
              錯誤代碼 <code className="font-mono">{error.digest}</code>
              　—— 回報問題時附上它，就能在伺服器日誌裡找到對應的那一筆。
            </p>
          )}
          <Button onClick={() => retry()}>再試一次</Button>
        </Card>
      </div>
    </>
  )
}
