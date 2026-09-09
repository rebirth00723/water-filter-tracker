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
