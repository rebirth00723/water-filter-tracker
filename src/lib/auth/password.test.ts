import { describe, expect, it } from 'vitest'
import { hashPassword, safeEqual, validatePassword, verifyPassword } from './password'

describe('密碼雜湊', () => {
  it('正確的密碼通過驗證', async () => {
    const h = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true)
  })

  it('錯誤的密碼不通過', async () => {
    const h = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('Correct horse battery staple', h)).toBe(false)
    expect(await verifyPassword('', h)).toBe(false)
  })

  it('同一個密碼每次雜湊結果不同（獨立 salt）', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    expect(await verifyPassword('same-password', a)).toBe(true)
    expect(await verifyPassword('same-password', b)).toBe(true)
  })

  it('儲存格式包含參數，日後調整 N 仍能驗證舊雜湊', async () => {
    const h = await hashPassword('x-password')
    expect(h).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/)
  })

  it('無密碼模式：stored 為 null 時一律不通過', async () => {
    expect(await verifyPassword('anything', null)).toBe(false)
  })

  it('壞掉的儲存格式回 false 而不是拋例外', async () => {
    for (const bad of ['', 'garbage', 'scrypt$x$y$z$a$b', 'bcrypt$1$2$3$4$5', 'scrypt$16384$8$1$$']) {
      await expect(verifyPassword('x', bad)).resolves.toBe(false)
    }
  })

  it('Unicode 正規化：視覺相同的輸入應等價', async () => {
    // é 的兩種表示法（單一碼位 vs e + 組合重音）
    const h = await hashPassword('café-password')
    expect(await verifyPassword('café-password', h)).toBe(true)
  })

  it('safeEqual 對不同長度不拋例外', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abcdef')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })

  it('密碼長度檢查', () => {
    expect(validatePassword('short')).toMatch(/至少/)
    expect(validatePassword('longenough')).toBeNull()
    expect(validatePassword('x'.repeat(2000))).toMatch(/過長/)
  })
})
