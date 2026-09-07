import { redirect } from 'next/navigation'
import { getAuthMode, getPrimaryUser } from './store'
import { currentSession } from './session'

export interface CurrentUser {
  username: string
  mustChangePassword: boolean
}

/**
 * 頁面與 Server Action 共用的授權關卡。
 *
 * `proxy.ts` 只驗 JWT 簽章（每個請求都跑，不該碰資料庫），
 * token_version 的比對與模式判斷放在這裡 —— 這裡本來就要讀資料庫。
 *
 * **Server Action 是公開的 HTTP 端點，每一個都必須自己呼叫這個函式**，
 * 不能只靠渲染表單的那個頁面做過檢查。
 */
export async function requireUser(): Promise<CurrentUser> {
  const mode = getAuthMode()

  if (mode === 'uninitialized') redirect('/setup')

  const user = getPrimaryUser()
  if (!user) redirect('/setup')

  // 無密碼模式：沒有登入層，直接放行
  if (mode === 'open') {
    return { username: user.username, mustChangePassword: false }
  }

  const session = await currentSession()
  if (!session) redirect('/login')
  if (session.username !== user.username) redirect('/login')
  if (session.ver !== user.tokenVersion) redirect('/login?reason=revoked')

  // 以臨時密碼登入的人，在改完密碼前只能待在改密碼頁
  if (user.mustChangePassword) redirect('/change-password')

  return { username: user.username, mustChangePassword: false }
}

/** 給 /change-password 用：要求已登入，但不因 mustChangePassword 再次導向（否則會無限迴圈） */
export async function requireSessionAllowingPasswordChange(): Promise<CurrentUser> {
  const mode = getAuthMode()
  if (mode === 'uninitialized') redirect('/setup')
  const user = getPrimaryUser()
  if (!user) redirect('/setup')
  if (mode === 'open') return { username: user.username, mustChangePassword: false }

  const session = await currentSession()
  if (!session) redirect('/login')
  if (session.ver !== user.tokenVersion) redirect('/login?reason=revoked')

  return { username: user.username, mustChangePassword: user.mustChangePassword }
}
