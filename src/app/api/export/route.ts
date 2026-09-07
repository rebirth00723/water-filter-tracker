import { audit } from '@/lib/audit'
import { clientIp, userAgent } from '@/lib/auth/client-ip'
import { requireUser } from '@/lib/auth/require'
import { todayTpe } from '@/lib/date'
import { exportAll } from '@/lib/transfer'

export const dynamic = 'force-dynamic'

/**
 * 匯出走 route handler 而不是 Server Action：Server Action 的回傳值會被
 * 序列化進 RSC payload，沒辦法觸發瀏覽器下載。這裡要的是一個真正的檔案回應。
 *
 * **`requireUser()` 必須自己呼叫。** route handler 不在 (app)/layout 底下，
 * 拿不到那一層的授權。
 */
export async function GET() {
  const user = await requireUser()
  const data = exportAll()

  const [ip, ua] = await Promise.all([clientIp(), userAgent()])
  audit({
    action: 'data.export',
    username: user.username,
    ip,
    userAgent: ua,
    summary:
      `匯出資料：${data.devices.length} 台設備、${data.events.length} 筆耗材紀錄、` +
      `${data.readings.length} 筆水質紀錄`,
  })

  const filename = `water-filter-tracker-${todayTpe()}.json`
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // filename* 用 RFC 5987 編碼，檔名裡就算有中文也不會壞
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
