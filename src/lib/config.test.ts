import { existsSync, rmSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = './data/config-test.sqlite3'
process.env.DATABASE_PATH = TEST_DB

const ENV_KEYS = [
  'PUBLIC_URL',
  'NTFY_URL',
  'NTFY_TOPIC_FILTER',
  'NTFY_TOPIC_SECURITY',
  'NTFY_TOKEN',
  'NTFY_USER',
  'NTFY_PASSWORD',
] as const

const cleanup = () => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(f)) rmSync(f)
  }
}

let db: typeof import('./db').db
let s: typeof import('./db/schema')
let config: typeof import('./config')

beforeAll(async () => {
  cleanup()
  for (const k of ENV_KEYS) delete process.env[k]
  db = (await import('./db')).db
  s = await import('./db/schema')
  ;(await import('./db/migrate')).runMigrations()
  config = await import('./config')
})

afterAll(cleanup)

afterEach(() => {
  db.delete(s.machineConfig).run()
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('環境變數的覆寫真的接上了', () => {
  /*
   * 這組測試存在的理由是**它們用 grep 看不到**：
   * config.ts 用一張 ENV_OVERRIDE 對照表，以 `env(envName)` 的變數形式讀取，
   * 所以靜態搜尋 `env('NTFY_URL')` 找不到任何結果。
   * 「文件寫了但其實沒接上」是這種寫法最容易出現的漂移。
   */
  it.each([
    ['ntfyUrl', 'NTFY_URL', 'http://ntfy:80'],
    ['ntfyTopicFilter', 'NTFY_TOPIC_FILTER', 'water-filter'],
    ['ntfyTopicSecurity', 'NTFY_TOPIC_SECURITY', 'water-security'],
    ['ntfyToken', 'NTFY_TOKEN', 'tk_abc123'],
    ['ntfyUser', 'NTFY_USER', 'rose'],
    ['ntfyPassword', 'NTFY_PASSWORD', 'hunter2'],
    ['publicUrl', 'PUBLIC_URL', 'https://water.example.com'],
  ] as const)('%s 讀得到 %s', (key, envName, value) => {
    const configKey = config.CONFIG_KEYS[key]
    expect(config.getConfig(configKey)).toBeUndefined()
    process.env[envName] = value
    expect(config.getConfig(configKey)).toBe(value)
    // 而且 UI 要知道它是唯讀的
    expect(config.isEnvControlled(configKey)).toBe(true)
  })

  it('環境變數優先於資料庫的值', () => {
    config.setConfig(config.CONFIG_KEYS.ntfyUrl, 'http://from-db')
    expect(config.getConfig(config.CONFIG_KEYS.ntfyUrl)).toBe('http://from-db')
    process.env.NTFY_URL = 'http://from-env'
    expect(config.getConfig(config.CONFIG_KEYS.ntfyUrl)).toBe('http://from-env')
  })

  it('空字串的環境變數視為未設定，不會把欄位鎖成唯讀', () => {
    /*
     * compose.yaml 把所有選填的變數都寫成 `NTFY_URL: ""` 當作說明文件。
     * 若空字串被當成「有設」，管理中心的欄位會全部變成唯讀，
     * 使用者就什麼都填不了 —— 而畫面只會說「由環境變數控制」。
     */
    process.env.NTFY_URL = ''
    expect(config.isEnvControlled(config.CONFIG_KEYS.ntfyUrl)).toBe(false)
    expect(config.getConfig(config.CONFIG_KEYS.ntfyUrl)).toBeUndefined()
    config.setConfig(config.CONFIG_KEYS.ntfyUrl, 'http://from-db')
    expect(config.getConfig(config.CONFIG_KEYS.ntfyUrl)).toBe('http://from-db')
  })

  it('由環境變數控制時，setConfig 拒絕寫入而不是靜默失效', () => {
    // 靜默失效的話使用者會改了、重啟、發現沒變，然後懷疑是不是壞了
    process.env.NTFY_URL = 'http://from-env'
    expect(() => config.setConfig(config.CONFIG_KEYS.ntfyUrl, 'x')).toThrow(/環境變數/)
  })

  it('passkey.enabled 沒有對應的環境變數 —— 它是資料庫層級的開關', () => {
    expect(config.isEnvControlled(config.CONFIG_KEYS.passkeyEnabled)).toBe(false)
  })

  it('getPublicUrl 去掉尾端斜線', () => {
    process.env.PUBLIC_URL = 'https://water.example.com///'
    expect(config.getPublicUrl()).toBe('https://water.example.com')
  })
})

describe('對外網址的路徑必須被正規化掉', () => {
  /*
   * 這是實際發生過的：使用者從瀏覽器網址列複製，於是存進去的是
   * `https://water.example.com/admin`。
   *
   * passkey 不受影響（RP ID 只看 hostname），所以問題不會立刻浮現 ——
   * 但 QR Code 會變成 `https://water.example.com/admin/d/1`、
   * 通知的點擊連結也一樣，兩者都是 404。
   * 而使用者要等到拿手機掃那張貼在機器上的標籤時才會發現。
   *
   * savePublicUrl 這個 action 難以在單元測試裡直接呼叫（需要 requireAdmin
   * 與請求脈絡），所以這裡驗的是 getPublicUrl 對已存值的處理，
   * 以及正規化本身的規則。
   */
  it('getPublicUrl 去掉尾端斜線但不會自己砍路徑 —— 所以寫入時就得擋', () => {
    config.setConfig(config.CONFIG_KEYS.publicUrl, 'https://water.example.com/admin')
    expect(config.getPublicUrl()).toBe('https://water.example.com/admin')
    // ↑ 這正是問題：讀取端不會救你，所以寫入端必須正規化
  })

  it('正規化的規則：origin + BASE_PATH，其餘路徑丟掉', () => {
    const normalize = (raw: string, basePath = '') => {
      const u = new URL(raw)
      return `${u.origin}${basePath}`
    }
    expect(normalize('https://water.example.com/admin')).toBe('https://water.example.com')
    expect(normalize('https://water.example.com/')).toBe('https://water.example.com')
    expect(normalize('https://water.example.com/d/1/report')).toBe('https://water.example.com')
    expect(normalize('https://water.example.com:8443/admin')).toBe('https://water.example.com:8443')
    // 掛在子路徑下時那個前綴是必要的，要保留
    expect(normalize('https://shared.example.com/water/admin', '/water')).toBe(
      'https://shared.example.com/water',
    )
  })
})
