import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { buttonClass, EmptyState } from '@/components/ui'

/**
 * 已登入狀態下的 404。
 *
 * **放在 `(app)` 群組而不是只放根目錄**，是為了讓這一頁**留在導覽列裡面** ——
 * 根目錄的 not-found 只被根 layout 包住，沒有側邊欄也沒有底部分頁，
 * 使用者會停在一個沒有出口的畫面上。
 *
 * 這一頁最常見的來路不是打錯網址，而是 `d/[deviceId]/layout.tsx` 的
 * `notFound()`：舊書籤、或掃到一張貼在已拆掉的機器上的 QR。
 * 所以文案講的是「這台設備」，不是泛泛的「找不到頁面」。
 */
export default function AppNotFound() {
  return (
    <>
      <PageHeader title="找不到這個頁面" />
      <div className="px-4 pb-6">
        <EmptyState
          title="這台設備不存在，或連結已經失效"
          description={
            <>
              可能是舊的書籤，或是貼在已經拆掉的機器上的 QR。
              設備一旦刪除，指向它的連結就不會再開得起來 ——
              這是刻意的：<strong>悄悄改顯示另一台的資料，比明確報錯危險得多。</strong>
            </>
          }
          action={
            <Link href="/" className={buttonClass('primary')}>
              回首頁
            </Link>
          }
        />
      </div>
    </>
  )
}
