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

  /*
   * 無密碼模式一律不從這裡設密碼 —— 那是 /admin 的入口。
   *
   * 原本的寫法是 `if (user.passwordHash && ...)`，於是 passwordHash 為 null 時
   * **整段守門被跳過**，這支 route 變成「不需要任何憑證就能設定密碼」。
   * 而它是 route handler，沒有 Server Action 的 Origin/Host 比對，
   * 所以區網裡任何一個惡意頁面都能用一張自動送出的表單把屋主鎖在自己的資料外。
   */
  if (!user.passwordHash) return seeOther('/admin')

  if (!session || session.username !== user.username) {
    return seeOther('/login')
  }

  /*
   * tokenVersion 也要比對。
   *
   * 這裡原本是整個系統唯一不吃撤銷的端點，而它正好是能改密碼的那一個：
   * 以臨時密碼登入的人在被撤銷之後，仍能用那張已作廢的 cookie
   * （且因為 mustChangePassword 為 true 而不需要舊密碼）設定新密碼並取得
   * 一張帶最新 tokenVersion 的全新 session，完成接管。
   */
  if (session.ver !== user.tokenVersion) {
    return seeOther('/login?reason=revoked')
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
