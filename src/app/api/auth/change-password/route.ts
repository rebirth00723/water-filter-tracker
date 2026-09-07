import { seeOther } from '@/lib/http'
import { audit } from '@/lib/audit'
import { clientIp, userAgent } from '@/lib/auth/client-ip'
import { safeEqual, validatePassword, verifyPassword } from '@/lib/auth/password'
import { currentSession, issueSession } from '@/lib/auth/session'
import { getPrimaryUser, setPassword } from '@/lib/auth/store'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

function back(req: Request, code: string) {
  return seeOther(`/change-password?error=${code}`)
}

export async function POST(req: Request) {
  const session = await currentSession()
  const user = getPrimaryUser()
  if (!user) return seeOther('/setup')

  // 無密碼模式沒有 session，但也不該從這裡設密碼（那是 /admin 的入口）
  if (user.passwordHash && (!session || session.username !== user.username)) {
    return seeOther('/login')
  }

  const form = await req.formData()
  const password = String(form.get('password') ?? '')
  const confirm = String(form.get('confirm') ?? '')
  const current = String(form.get('current') ?? '')

  // 一般修改要先驗證目前的密碼；強制修改（臨時密碼登入）時使用者本來就不知道舊密碼
  if (!user.mustChangePassword && user.passwordHash) {
    if (!(await verifyPassword(current, user.passwordHash))) {
      return back(req, 'current_password_wrong')
    }
  }

  if (password !== confirm) return back(req, 'password_mismatch')
  if (validatePassword(password)) return back(req, 'password_weak')

  // 新密碼不能就是臨時密碼，否則移除 env 之後反而進不去
  const temp = env('TEMP_PASSWORD')
  if (temp && safeEqual(password, temp)) return back(req, 'password_same_as_temp')

  await setPassword(user.username, password)

  const fresh = getPrimaryUser()
  await issueSession(user.username, fresh?.tokenVersion ?? 1)

  audit({
    action: 'password.change',
    username: user.username,
    ip: await clientIp(),
    userAgent: await userAgent(),
    summary: user.mustChangePassword ? '以臨時密碼登入後完成密碼設定' : '修改密碼',
  })

  return seeOther('/')
}
