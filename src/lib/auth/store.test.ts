import { existsSync, rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = './data/auth-store-test.sqlite3'
process.env.DATABASE_PATH = TEST_DB
delete process.env.TEMP_PASSWORD

const cleanup = () => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(f)) rmSync(f)
  }
}

let store: typeof import('./store')
let password: typeof import('./password')

beforeAll(async () => {
  cleanup()
  await import('../db')
  ;(await import('../db/migrate')).runMigrations()
  store = await import('./store')
  password = await import('./password')
})

afterAll(cleanup)

describe('setPassword 收的是明文', () => {
  it('設完之後用同一個明文登入必須成功', async () => {
    /*
     * 這個測試釘住的是一個真的發生過的 bug：管理中心的 action 寫成
     * `setPassword(user, await hashPassword(pw))`，於是密碼被雜湊兩次。
     * 兩個參數都是 string，型別檢查完全抓不到，
     * 症狀是「設好密碼卻登不進去」—— 而使用者只會以為自己記錯了。
     */
    await store.initialize('rose', 'first-password-123')
    await store.setPassword('rose', 'second-password-456')

    const ok = await store.verifyLogin('rose', 'second-password-456')
    expect(ok.ok).toBe(true)

    const bad = await store.verifyLogin('rose', 'first-password-123')
    expect(bad.ok).toBe(false)
  })

  it('存進去的不是明文', async () => {
    await store.setPassword('rose', 'plain-text-here')
    const user = store.getPrimaryUser()!
    expect(user.passwordHash).not.toContain('plain-text-here')
    expect(user.passwordHash).toMatch(/^scrypt\$/)
    // 而且雜湊本身驗得過
    expect(await password.verifyPassword('plain-text-here', user.passwordHash!)).toBe(true)
  })

  it('bumpTokenVersion 遞增，用於登出所有裝置', () => {
    const before = store.getPrimaryUser()!.tokenVersion
    const next = store.bumpTokenVersion('rose')
    expect(next).toBe(before + 1)
    expect(store.getPrimaryUser()!.tokenVersion).toBe(next)
  })

  it('setPassword 會清掉 mustChangePassword', async () => {
    store.markMustChangePassword('rose', true)
    expect(store.getPrimaryUser()!.mustChangePassword).toBe(true)
    await store.setPassword('rose', 'another-password-789')
    expect(store.getPrimaryUser()!.mustChangePassword).toBe(false)
  })
})
