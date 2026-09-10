import { existsSync, rmSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = './data/passkey-test.sqlite3'
process.env.DATABASE_PATH = TEST_DB
delete process.env.PUBLIC_URL
delete process.env.TEMP_PASSWORD

const cleanup = () => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(f)) rmSync(f)
  }
}

let db: typeof import('../db').db
let s: typeof import('../db/schema')
let pk: typeof import('./passkey')
let config: typeof import('../config')
let store: typeof import('./store')

beforeAll(async () => {
  cleanup()
  db = (await import('../db')).db
  s = await import('../db/schema')
  ;(await import('../db/migrate')).runMigrations()
  pk = await import('./passkey')
  config = await import('../config')
  store = await import('./store')
  await store.initialize('rose', 'a-real-password-123')
})

afterAll(cleanup)

afterEach(() => {
  db.delete(s.machineConfig).run()
  db.delete(s.credentials).run()
})

const setUrl = (url: string) => config.setConfig(config.CONFIG_KEYS.publicUrl, url)
const enable = () => config.setConfig(config.CONFIG_KEYS.passkeyEnabled, 'true')

describe('rpConfig —— RP ID 必須是網域名稱', () => {
  it('從 https 網域推導 rpID 與 origin', () => {
    setUrl('https://water.example.com')
    expect(pk.rpConfig()).toEqual({
      rpID: 'water.example.com',
      rpName: '淨水器記錄',
      origin: 'https://water.example.com',
    })
  })

  it('origin 含非標準連接埠 —— WebAuthn 比對的是完整 origin', () => {
    // 少了埠號在自架的非標準埠上會驗簽失敗，而錯誤訊息完全看不出原因
    setUrl('https://water.example.com:8443')
    expect(pk.rpConfig()?.origin).toBe('https://water.example.com:8443')
    // 但 rpID 不含埠號 —— 規範如此
    expect(pk.rpConfig()?.rpID).toBe('water.example.com')
  })

  it('http 不行 —— WebAuthn 只在安全內容下存在', () => {
    setUrl('http://water.example.com')
    expect(pk.rpConfig()).toBeNull()
  })

  it('IP 位址不行 —— RP ID 不接受 IP', () => {
    for (const url of ['https://192.168.0.30', 'https://192.168.0.30:8085', 'https://[::1]']) {
      setUrl(url)
      expect(pk.rpConfig()).toBeNull()
    }
  })

  it('localhost 不行 —— 不是完整網域名稱', () => {
    setUrl('https://localhost:8085')
    expect(pk.rpConfig()).toBeNull()
  })

  it('沒設對外網址時回 null', () => {
    expect(pk.rpConfig()).toBeNull()
  })

  it('尾端斜線不影響推導', () => {
    setUrl('https://water.example.com/')
    expect(pk.rpConfig()?.origin).toBe('https://water.example.com')
  })
})

describe('passkeyUsable —— 三個條件都要滿足', () => {
  it('條件不滿足時回傳可顯示的原因，而不只是 false', () => {
    // UI 要能說明為什麼不能用，否則使用者只看到一個沒反應的開關
    const r = pk.passkeyUsable()
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
    expect(r.reason).toContain('對外網址')
  })

  it('網址合格但管理員沒開啟 → 不可用', () => {
    setUrl('https://water.example.com')
    const r = pk.passkeyUsable()
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('尚未啟用')
  })

  it('三個條件都滿足 → 可用', () => {
    setUrl('https://water.example.com')
    enable()
    expect(pk.passkeyUsable()).toEqual({ ok: true })
  })

  it('沒有密碼時不可用 —— passkey 只能是密碼之外的快捷', async () => {
    /*
     * passkey 綁定裝置與網域：裝置遺失、換網域、或在沒有 HTTPS 的環境下
     * 都會失效，此時密碼是唯一的退路。只有 passkey 就等於把自己鎖在門外。
     */
    setUrl('https://water.example.com')
    enable()
    db.update(s.authState).set({ passwordHash: null }).run()
    const r = pk.passkeyUsable()
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('尚未設定密碼')
    await store.setPassword('rose', 'a-real-password-123')
  })
})

describe('挑戰是一次性的', () => {
  it('取出之後就消失 —— 重放必須失敗', () => {
    pk.saveChallenge('register', 'rose', 'chal-abc')
    expect(pk.takeChallenge('register', 'rose')).toBe('chal-abc')
    expect(pk.takeChallenge('register', 'rose')).toBeNull()
  })

  it('註冊與登入的挑戰是分開的槽位', () => {
    // 混在一起的話，一個進行中的註冊會被一次登入嘗試偷走挑戰
    pk.saveChallenge('register', 'rose', 'reg-1')
    pk.saveChallenge('login', 'rose', 'log-1')
    expect(pk.takeChallenge('login', 'rose', 'log-1')).toBe('log-1')
    expect(pk.takeChallenge('register', 'rose')).toBe('reg-1')
  })

  it('登入挑戰可同時存在數個 —— 別人打一次 GET 不會洗掉你進行中的那個', () => {
    /*
     * 產生登入挑戰的 GET 端點不需要驗證（那是它的用途）。
     * 單一槽位的話，任何人打一次就會讓使用者按了 Face ID 之後
     * 得到「挑戰已逾時」。
     */
    pk.saveChallenge('login', 'rose', 'mine-abcdefghijk')
    pk.saveChallenge('login', 'rose', 'someone-elses-xyz')
    expect(pk.takeChallenge('login', 'rose', 'mine-abcdefghijk')).toBe('mine-abcdefghijk')
  })

  it('挑戰值對不上時回 null，不會拿別的槽位頂替', () => {
    pk.saveChallenge('login', 'rose', 'real-challenge-1')
    expect(pk.takeChallenge('login', 'rose', 'forged-challenge')).toBeNull()
  })

  it('沒有挑戰時回 null 而不是拋錯', () => {
    expect(pk.takeChallenge('login', 'nobody')).toBeNull()
  })
})

describe('憑證 CRUD', () => {
  const make = (id: string, label: string) =>
    pk.saveCredential({
      username: 'rose',
      credentialId: id,
      publicKey: 'cHVibGljLWtleQ',
      counter: 0,
      transports: ['internal', 'hybrid'],
      deviceLabel: label,
    })

  it('存下的是公鑰，沒有任何私密材料', () => {
    const row = make('cred-1', 'iPhone')
    const cols = Object.keys(row)
    // 這張表不該有任何看起來像密鑰或密碼的欄位
    for (const forbidden of ['privateKey', 'secret', 'password', 'passwordHash']) {
      expect(cols).not.toContain(forbidden)
    }
    expect(row.publicKey).toBe('cHVibGljLWtleQ')
  })

  it('依 credentialId 查得到', () => {
    make('cred-1', 'iPhone')
    expect(pk.findCredential('cred-1')?.deviceLabel).toBe('iPhone')
    expect(pk.findCredential('nope')).toBeUndefined()
  })

  it('counter 更新並記錄上次使用時間', () => {
    make('cred-1', 'iPhone')
    expect(pk.findCredential('cred-1')?.lastUsedAt).toBeNull()
    pk.bumpCounter('cred-1', 42)
    const after = pk.findCredential('cred-1')!
    expect(after.counter).toBe(42)
    expect(after.lastUsedAt).toBeTypeOf('number')
  })

  it('刪除限定自己的憑證 —— 別人的 id 刪不掉', () => {
    const mine = make('cred-1', 'iPhone')
    db.insert(s.credentials)
      .values({ username: 'someone-else', credentialId: 'cred-2', publicKey: 'x' })
      .run()
    const other = db
      .select()
      .from(s.credentials)
      .all()
      .find((c) => c.username === 'someone-else')!

    expect(pk.deleteCredential('rose', other.id)).toBeUndefined()
    expect(pk.findCredential('cred-2')).toBeDefined()
    expect(pk.deleteCredential('rose', mine.id)?.credentialId).toBe('cred-1')
  })

  it('改名同樣限定自己的憑證', () => {
    const mine = make('cred-1', 'iPhone')
    expect(pk.renameCredential('someone-else', mine.id, '偷改')).toBeUndefined()
    expect(pk.renameCredential('rose', mine.id, 'iPhone 15')?.deviceLabel).toBe('iPhone 15')
  })

  it('一次清空只清自己的', () => {
    make('cred-1', 'a')
    make('cred-2', 'b')
    db.insert(s.credentials)
      .values({ username: 'someone-else', credentialId: 'cred-9', publicKey: 'x' })
      .run()
    expect(pk.deleteAllCredentials('rose')).toBe(2)
    expect(pk.countCredentials('rose')).toBe(0)
    expect(pk.findCredential('cred-9')).toBeDefined()
  })
})

describe('parseTransports', () => {
  it('認得規範定義的值', () => {
    expect(pk.parseTransports('["internal","hybrid","usb","nfc","ble","cable","smart-card"]'))
      .toEqual(['internal', 'hybrid', 'usb', 'nfc', 'ble', 'cable', 'smart-card'])
  })

  it('丟掉規範沒有的值，而不是原樣傳給瀏覽器', () => {
    /*
     * 認不出來的值直接丟掉：transports 只是給瀏覽器的提示，少一個不影響登入。
     * 而傳一個規範沒有的字串進 navigator.credentials 會變成一個很難查的錯誤。
     */
    expect(pk.parseTransports('["internal","telepathy",42,null]')).toEqual(['internal'])
  })

  it('壞掉的 JSON 與 null 都回空陣列而不是拋錯', () => {
    expect(pk.parseTransports(null)).toEqual([])
    expect(pk.parseTransports('not json')).toEqual([])
    expect(pk.parseTransports('{"a":1}')).toEqual([])
  })
})
