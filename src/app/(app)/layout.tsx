import { BottomTabBar } from '@/components/nav/BottomTabBar'
import { DesktopSidebar } from '@/components/nav/DesktopSidebar'
import { Toaster } from '@/components/ui/Toaster'
import { requireUser } from '@/lib/auth/require'
import { listDeviceIds, resolveDeviceId } from '@/lib/devices'

/**
 * 這個 layout 底下的所有頁面都需要授權，而授權要讀資料庫與 cookie ——
 * 建置期的靜態預先渲染沒有請求脈絡，會在 redirect 時失敗。
 * 全部標為動態渲染。
 */
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  // proxy.ts 刻意不做授權（它不該碰資料庫），所以這裡是實際的關卡：
  // 判斷模式（未初始化／無密碼／密碼）、比對 token_version、處理強制改密碼
  await requireUser()

  /*
   * 導覽列在網址裡沒有設備時（例如設定頁）要有個地方可去，這就是那個備援值。
   * 網址裡有設備時由客戶端以網址為準覆蓋掉它 —— 詳見 nav-items.ts 的 navDeviceId。
   */
  const fallbackDeviceId = await resolveDeviceId()

  /*
   * 導覽列還要知道「網址裡那個 id 存不存在」——
   * 打開已刪除設備的舊連結會走到 404，而那一頁的導覽列若只看網址，
   * 五個分頁有四個指回同一個死掉的 id。
   */
  const knownDeviceIds = listDeviceIds()

  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar fallbackDeviceId={fallbackDeviceId} knownDeviceIds={knownDeviceIds} />
      {/* pb-20 讓最後一列不會被底部導覽列蓋住 */}
      <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>
      <BottomTabBar fallbackDeviceId={fallbackDeviceId} knownDeviceIds={knownDeviceIds} />
      <Toaster />
    </div>
  )
}
