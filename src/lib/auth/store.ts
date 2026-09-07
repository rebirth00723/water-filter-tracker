import { eq } from 'drizzle-orm'
import { db } from '../db'
import { authState } from '../db/schema'
import { env } from '../env'
import { hashPassword, safeEqual, verifyPassword } from './password'

/**
 * 系統的三種模式：
 *
 * - `uninitialized`：還沒跑過初始化 → 導向 /setup
 * - `open`：使用者明確選擇不設密碼 → 沒有登入層，適合純區網不對外
 * - `password`：一般情況
 *
 * 從 open 切換成 password 的入口在 /admin —— 那個模式下 /admin 本身就是信任邊界，
 * 不需要 session 就能進入設定密碼，這是刻意留的補救路。
 */
export type AuthMode = 'uninitialized' | 'open' | 'password'

export type AuthUser = typeof authState.$inferSelect

/** 單人系統：只有一列。回傳它，沒有就是還沒初始化 */
export function getPrimaryUser(): AuthUser | undefined {
  return db.select().from(authState).limit(1).get()
}

export function getAuthMode(): AuthMode {
  const user = getPrimaryUser()
  if (!user) return 'uninitialized'
  return user.passwordHash ? 'password' : 'open'
}

export function isInitialized(): boolean {
  return getPrimaryUser() !== undefined
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{1,32}$/

export function validateUsername(name: string): string | null {
  if (!USERNAME_RE.test(name)) {
    return '使用者名稱只能使用英數字、底線、句點與連字號，最長 32 字元'
  }
  return null
}

/** 初始化。password 為 null 代表使用者明確選擇「不設密碼」 */
export async function initialize(username: string, password: string | null): Promise<void> {
  if (isInitialized()) throw new Error('系統已初始化')
  db.insert(authState)
    .values({
      username,
      passwordHash: password ? await hashPassword(password) : null,
      mustChangePassword: false,
    })
    .run()
}

export async function setPassword(username: string, password: string): Promise<void> {
  db.update(authState)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: false })
    .where(eq(authState.username, username))
    .run()
}

export function bumpTokenVersion(username: string): number {
  const user = db.select().from(authState).where(eq(authState.username, username)).get()
  const next = (user?.tokenVersion ?? 1) + 1
  db.update(authState).set({ tokenVersion: next }).where(eq(authState.username, username)).run()
  return next
}

export function recordLogin(username: string): void {
  db.update(authState).set({ lastLoginAt: Date.now() }).where(eq(authState.username, username)).run()
}

export function markMustChangePassword(username: string, on: boolean): void {
  db.update(authState)
    .set({ mustChangePassword: on })
    .where(eq(authState.username, username))
    .run()
}

/** env 裡是否還留著臨時密碼。只要留著就是永久後門，每次登入都要提醒 */
export function tempPasswordPresent(): boolean {
  return (env('TEMP_PASSWORD')?.length ?? 0) > 0
}

export type LoginResult =
  | { ok: true; username: string; viaTempPassword: boolean }
  | { ok: false }

/**
 * 驗證登入。
 *
 * 臨時密碼**不比對使用者名稱** —— 單人系統裡使用者名稱不構成額外的憑證，
 * 而救援情境下人可能連名稱都忘了。臨時密碼本身就是那個憑證。
 */
export async function verifyLogin(username: string, password: string): Promise<LoginResult> {
  const user = getPrimaryUser()
  if (!user) return { ok: false }

  const temp = env('TEMP_PASSWORD')
  if (temp && safeEqual(password, temp)) {
    return { ok: true, username: user.username, viaTempPassword: true }
  }

  if (user.username !== username.trim()) return { ok: false }
  if (!(await verifyPassword(password, user.passwordHash))) return { ok: false }

  return { ok: true, username: user.username, viaTempPassword: false }
}
