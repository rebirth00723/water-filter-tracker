import { sqlite } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** 供 docker healthcheck 使用。不需驗證，但也不洩漏任何內容 */
export function GET() {
  try {
    // 真的碰一下資料庫：process 活著但 SQLite 打不開是我們最想抓到的狀況
    sqlite().prepare('SELECT 1').get()
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false }, { status: 503 })
  }
}
