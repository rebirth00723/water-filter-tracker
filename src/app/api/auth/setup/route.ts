import { seeOther } from '@/lib/http'
import { audit } from '@/lib/audit'
import { clientIp, userAgent } from '@/lib/auth/client-ip'
import { validatePassword } from '@/lib/auth/password'
import { issueSession } from '@/lib/auth/session'
import { getPrimaryUser, initialize, isInitialized, validateUsername } from '@/lib/auth/store'

export const dynamic = 'force-dynamic'

function back(req: Request, code: string) {
  return seeOther(`/setup?error=${code}`)
}

export async function POST(req: Request) {
  if (isInitialized()) return back(req, 'already_initialized')

  const form = await req.formData()
  const username = String(form.get('username') ?? '').trim()
  const password = String(form.get('password') ?? '')
  const confirm = String(form.get('confirm') ?? '')
  const noPassword = form.get('mode') === 'no-password'

  if (validateUsername(username)) return back(req, 'username_invalid')

  if (!noPassword) {
    if (password !== confirm) return back(req, 'password_mismatch')
    if (validatePassword(password)) return back(req, 'password_weak')
  }

  await initialize(username, noPassword ? null : password)

  const user = getPrimaryUser()
  if (user && !noPassword) {
    await issueSession(user.username, user.tokenVersion)
  }

  audit({
    action: 'setup.complete',
    username,
    ip: await clientIp(),
    userAgent: await userAgent(),
    summary: noPassword ? '完成初始化（未設密碼）' : '完成初始化並設定密碼',
  })

  return seeOther('/')
}
