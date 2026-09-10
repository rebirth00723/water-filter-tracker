'use client'

import { LogOut } from 'lucide-react'
import { withBasePath } from '@/lib/base-path'
import { buttonClass } from '@/components/ui'

/**
 * 登出。
 *
 * 用真正的 `<form method="POST">` 而不是 fetch：
 * 登出會設定 cookie，而 cookie 是由伺服端的回應標頭設的 ——
 * 用 fetch 的話還要自己處理導向，且客戶端路由不會重跑 layout 的授權檢查，
 * 於是會停在一個「已經登出但畫面還在」的狀態。整頁 POST + 303 最單純也最可靠。
 *
 * `all=1` 會遞增 tokenVersion，讓**所有裝置**的 session 一起失效 ——
 * 這是懷疑 cookie 外洩時真正有效的手段（而且不受 SESSION_SECRET 影響，
 * 不像重新產生金鑰那條路）。
 */
export function LogoutButton({ allDevices = false }: { allDevices?: boolean }) {
  return (
    <form method="POST" action={withBasePath(`/api/auth/logout${allDevices ? '?all=1' : ''}`)}>
      <button type="submit" className={buttonClass(allDevices ? 'secondary' : 'secondary', 'md', 'w-full')}>
        <LogOut className="size-4" aria-hidden />
        {allDevices ? '登出所有裝置' : '登出'}
      </button>
    </form>
  )
}
