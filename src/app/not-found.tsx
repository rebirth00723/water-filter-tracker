import Link from 'next/link'
import { AuthShell, buttonClass } from '@/components/AuthShell'

/**
 * 完全比對不到路由時的 404（例如 `/nonsense`）。
 *
 * 已登入區另有一份 `(app)/not-found.tsx`，那份留在導覽列裡面。
 * 這一份只被根 layout 包住，所以走登入頁那套版面 ——
 * 未登入的人也可能撞到這裡。
 */
export default function NotFound() {
  return (
    <AuthShell title="找不到這個頁面" description="網址可能打錯了，或這個連結已經失效。">
      <Link href="/" className={buttonClass + ' flex items-center justify-center'}>
        回首頁
      </Link>
    </AuthShell>
  )
}
