import { NextResponse, type NextRequest } from 'next/server'
import { LAST_DEVICE_COOKIE, deviceIdFromPath } from '@/lib/device-path'
import { log } from '@/lib/log'

/**
 * Next 16 把 middleware 改名為 proxy，且固定跑在 Node.js runtime。
 *
 * **這一層刻意不做授權判斷。** 授權需要知道系統目前是「無密碼」還是「密碼」模式，
 * 而那要讀資料庫 —— proxy 每個請求都跑，不該碰 DB。
 * 授權統一由 `requireUser()` 負責（layout、Server Action、route handler 各自呼叫）。
 *
 * 這裡只做四件不需要資料庫的事：存取紀錄、安全標頭、CSP nonce，
 * 以及記錄「最後看的是哪一台設備」。
 */

/** 依序嘗試常見的來源 IP header。僅供記錄，不參與授權，設錯只會讓日誌不準 */
function sourceIp(req: NextRequest): string {
  const configured = process.env.REAL_IP_HEADER?.trim()
  if (configured) return req.headers.get(configured)?.trim() || 'unknown'

  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf

  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    // 最右段是「最靠近我們的那層代理所填的值」，是整條鏈上唯一不可偽造的一段
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    const last = parts.at(-1)
    if (last) return last
  }
  return 'unknown'
}

export function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  const csp = [
    `default-src 'self'`,
    // strict-dynamic 讓 Next 注入的 hydration script 能載入它自己的 chunk
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Tailwind 與 ECharts 都會寫 inline style，這裡沒有更緊的選項
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // 防點擊劫持。這個 App 沒有被嵌入的需求
    `frame-ancestors 'none'`,
  ].join('; ')

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('Content-Security-Policy', csp)
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  // 刻意不設 HSTS：一旦送出長 max-age 就不可逆，會把純 HTTP 自架的人鎖死

  const { pathname, search } = req.nextUrl

  /*
   * 記錄最後使用的設備，唯一用途是決定 `/` 要導向哪一台。
   *
   * **這件事只能在這裡做。** Server Component 的渲染過程不允許寫 cookie，
   * 而 `/d/<id>` 是頁面而不是 Server Action —— 若改用 client 端 effect 回打一個
   * action，等於每次瀏覽都多一次往返，只為了寫一個偏好值。
   *
   * 這裡不驗證這個 id 是否真的存在（proxy 不碰資料庫）。不驗證是安全的：
   * 網址本身錯的話該頁面會 404，而 `/` 的解析會再拿 cookie 去比對資料庫，
   * 對不上就退回第一台。所以最壞情況只是這個偏好值被忽略。
   */
  const viewing = deviceIdFromPath(pathname)
  if (viewing !== null) {
    res.cookies.set({
      name: LAST_DEVICE_COOKIE,
      value: String(viewing),
      httpOnly: true, // 沒有任何前端程式需要讀它
      // 純 HTTP 下帶 Secure 會被瀏覽器直接丟棄，因此依實際協定判斷（與 session cookie 同一套規則）
      secure: req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 86_400,
    })
  }

  log.info('request', {
    method: req.method,
    path: pathname,
    // 註冊與登入類路徑的 query 可能含敏感值，一律不記錄
    query: pathname.startsWith('/api/auth') ? undefined : search || undefined,
    ip: sourceIp(req),
    ua: req.headers.get('user-agent')?.slice(0, 200) ?? undefined,
  })

  return res
}

export const config = {
  matcher: [
    // 排除靜態資源與圖片最佳化，否則每個 CSS/JS 請求都會產生一行日誌
    '/((?!_next/static|_next/image|favicon\\.ico|icons/|manifest\\.webmanifest).*)',
  ],
}
