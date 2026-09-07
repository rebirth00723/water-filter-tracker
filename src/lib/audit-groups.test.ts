import { describe, expect, it } from 'vitest'
import { AUDIT_GROUPS, groupOf } from './audit-groups'

/** 程式碼裡實際會寫入的動作名稱。新增動作時要一起加進來 */
const REAL_ACTIONS = [
  'setup.complete',
  'login.ok',
  'login.ok.passkey',
  'login.fail.bad_credentials',
  'login.fail.throttled',
  'login.fail.locked',
  'login.fail.duplicate',
  'login.fail.passkey_unknown',
  'login.fail.passkey_verify',
  'logout',
  'password.change',
  'passkey.register.ok',
  'passkey.register.fail',
  'passkey.delete',
  'passkey.rename',
  'admin.publicUrl',
  'admin.ntfy',
  'admin.ntfyTest',
  'admin.ntfyTest.fail',
  'admin.setPassword',
  'admin.regenSessionKey',
  'admin.passkeyToggle',
  'admin.revokeCredential',
  'admin.revokeAllCredentials',
  'admin.sweep',
  'device.create',
  'device.update',
  'device.delete',
  'device.reorder',
  'category.create',
  'category.update',
  'category.delete',
  'category.reorder',
  'category.deactivateCovered',
  'item.create',
  'item.update',
  'item.delete',
  'event.create',
  'event.update',
  'event.delete',
  'reading.create',
  'reading.update',
  'reading.delete',
  'notifyRule.create',
  'notifyRule.update',
  'notifyRule.delete',
  'notifyPrefs.update',
  'notify.manual',
  'data.export',
  'data.import',
  'data.import.fail',
]

describe('每一個動作都要配到分類', () => {
  it('沒有任何動作是沒有分類的', () => {
    /*
     * 這個測試是修一個真 bug 時加的：`logout` 與 `password.change`
     * 因為前綴清單寫成 `'login.'`（帶點）而配不到任何分類，
     * 在操作紀錄頁上就少了徽章 —— 那種缺漏只有一筆一筆看才會發現。
     *
     * 型別層另有保護（AuditAction 收窄成已知前綴），這裡補的是
     * 「前綴存在但分類表漏了它」的那一半。
     */
    const ungrouped = REAL_ACTIONS.filter((a) => groupOf(a) === null)
    expect(ungrouped).toEqual([])
  })

  it('前綴本身（不帶點）也算得出分類', () => {
    expect(groupOf('logout')).toBe('login')
  })

  it('notifyRule 歸「設定」而不是「通知」', () => {
    /*
     * 這是不能用單純 startsWith 的理由：`notifyRule.create` 的開頭
     * 也符合 `notify`，順序相依的比對會把它歸到「通知」——
     * 而它其實是設定變更。所以比對「前綴本身」或「前綴 + 點」。
     */
    expect(groupOf('notifyRule.create')).toBe('config')
    expect(groupOf('notifyPrefs.update')).toBe('config')
    expect(groupOf('notify.manual')).toBe('notify')
  })

  it('未知的動作回 null 而不是硬塞一個分類', () => {
    expect(groupOf('something.else')).toBeNull()
    expect(groupOf('')).toBeNull()
  })

  it('每個分類的前綴都不重複出現在兩個分類裡', () => {
    // 重複的話 groupOf 的結果會取決於 Object.entries 的順序，那是脆的
    const seen = new Map<string, string>()
    for (const [key, g] of Object.entries(AUDIT_GROUPS)) {
      for (const p of g.prefixes as readonly string[]) {
        expect(seen.has(p), `前綴「${p}」同時屬於 ${seen.get(p)} 與 ${key}`).toBe(false)
        seen.set(p, key)
      }
    }
  })
})
