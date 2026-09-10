import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { audit } from '@/lib/audit'
import { clientIp, userAgent } from '@/lib/auth/client-ip'
import { LOGIN_FAILED } from '@/lib/auth/messages'
import { rateLimiter } from '@/lib/auth/ratelimit'
import { issueSession } from '@/lib/auth/session'
import { BASE_PATH, seeOther } from '@/lib/http'
import {
  getPrimaryUser,
  markMustChangePassword,
  recordLogin,
  tempPasswordPresent,
  verifyLogin,
} from '@/lib/auth/store'

export const dynamic = 'force-dynamic'

/**
 * 固定回應時間下限。用「補到下限」而不是「事後固定 sleep」——
 * 後者只是把變動的處理時間整段往後平移，總時間依然洩漏差異。
 */
const FLOOR_MS = 500

/**
 * 只接受站內路徑，避免變成開放轉址。
 *
 * `//evil.com` 會被瀏覽器當成 protocol-relative 的絕對網址，所以要單獨擋 ——
 * 它通過了「開頭是 /」的檢查卻會把人送到別的站。
 *
 * 回傳的是**不含 BASE_PATH 的路徑**，因為 `seeOther()` 會補前綴。
 * 進來的值若已帶前綴（連結都會帶）就先剝掉，否則子路徑部署會變成 /water/water/…
 */
function safeNext(next: string | null): string {
  if (!next) return '/'
  /*
   * 反斜線要一起擋。瀏覽器在解析網址時把 `\` 正規化成 `/`，
   * 所以 `/\evil.com` 會變成 `//evil.com` —— 一個 protocol-relative 的絕對網址。
   * 只檢查 `//` 的話這條路徑會通過，變成登入後的開放轉址。
   */
  const normalized = next.replace(/\\/g, '/')
  if (!normalized.startsWith('/') || normalized.startsWith('//')) return '/'
  // 控制字元同樣可能被瀏覽器忽略後改變語意
  if (/[\x00-\x1f\x7f]/.test(next)) return '/'
  next = normalized
  if (BASE_PATH && next.startsWith(`${BASE_PATH}/`)) return next.slice(BASE_PATH.length)
  if (BASE_PATH && next === BASE_PATH) return '/'
  return next
}

export async function POST(req: Request) {
  const started = Date.now()

  const finish = async (res: NextResponse) => {
    const remain = FLOOR_MS - (Date.now() - started)
    if (remain > 0) await new Promise((r) => setTimeout(r, remain))
    return res
  }

  const form = await req.formData()
  const username = String(form.get('username') ?? '').trim()
  const password = String(form.get('password') ?? '')
  const next = safeNext(form.get('next') ? String(form.get('next')) : null)

  const ip = await clientIp()
  const ua = await userAgent()

  // 所有失敗共用同一個代碼：狀態碼、訊息、網址、回應時間都不可分辨
  const deny = () =>
    finish(seeOther(`/login?error=${LOGIN_FAILED}`))

  const user = getPrimaryUser()
  if (!user) return finish(seeOther('/setup'))

  // 限流只綁帳號。密碼是可暴力破解的，所以這一層在密碼模式下是核心防護
  const submissionHash = createHash('sha256')
    .update(`${username}\0${password}`, 'utf8')
    .digest('hex')
  const verdict = rateLimiter.check(user.username, submissionHash)
  if (!verdict.allowed) {
    audit({
      action: `login.fail.${verdict.reason}`,
      username: user.username,
      ip,
      userAgent: ua,
      summary: `登入被限流（${verdict.reason}）`,
    })
    return deny()
  }

  const result = await verifyLogin(username, password)
  if (!result.ok) {
    rateLimiter.fail(user.username)
    audit({
      action: 'login.fail.bad_credentials',
      username: user.username,
      ip,
      userAgent: ua,
      summary: '登入失敗：帳號或密碼錯誤',
    })
    return deny()
  }

  rateLimiter.succeed(user.username)
  recordLogin(result.username)

  if (result.viaTempPassword) {
    markMustChangePassword(result.username, true)
  }

  const fresh = getPrimaryUser()
  await issueSession(result.username, fresh?.tokenVersion ?? 1)

  audit({
    action: 'login.ok',
    username: result.username,
    ip,
    userAgent: ua,
    summary: result.viaTempPassword
      ? '以臨時密碼登入，已要求修改密碼'
      : `登入成功${tempPasswordPresent() ? '（環境變數仍留有臨時密碼）' : ''}`,
  })

  const dest = result.viaTempPassword ? '/change-password' : next
  return finish(seeOther(dest))
}
