import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SignJWT, jwtVerify } from 'jose'
import { cookies, headers } from 'next/headers'
import { env, envInt } from '../env'
import { log } from '../log'

const ISS = 'water-filter-tracker'
const AUD = 'water-filter-tracker-web'

/** __Host- 前綴強制要求 Secure + Path=/ + 無 Domain，只有 HTTPS 下設得進去 */
export const SECURE_COOKIE = '__Host-session'
export const PLAIN_COOKIE = 'session'

export interface SessionPayload {
  username: string
  /** 對應 auth_state.token_version，遞增即可讓所有已簽發的 session 失效 */
  ver: number
}

let keyCache: Uint8Array | undefined

/**
 * 這個模組裡的 fs 呼叫都標了 turbopackIgnore：路徑是 runtime 才算得出來的，
 * 不標的話 Next 的靜態分析會把整個專案（含 node_modules）納入 standalone 追蹤範圍，
 * 造成 bundle 暴增與建置極慢。這些是執行期的檔案存取，不是 build-time 資產。
 */
function keyPath(): string {
  const dbPath = env('DATABASE_PATH') ?? './data/app.sqlite3'
  return env('SESSION_KEY_PATH') ?? join(dirname(dbPath), 'session.key')
}

/**
 * session 金鑰：簽署登入通行證用的印章。
 *
 * 首次啟動自動產生並以 0600 寫入檔案。這比「沒設就拒絕啟動」好，因為
 * **每一份部署天生就有不同的金鑰** —— 靜默地消滅了「共用寫死預設值」
 * 這個最危險的失敗模式，使用者不需要理解它就已經安全了。
 *
 * 刻意放在檔案而不是資料庫：`settings` 會被 JSON 匯出帶走，
 * 金鑰放那裡每次匯出都等於把它一起交出去。
 */
function key(): Uint8Array {
  if (keyCache) return keyCache

  const fromEnv = env('SESSION_SECRET')
  if (fromEnv) {
    if (fromEnv.length < 32) {
      throw new Error('SESSION_SECRET 長度不足 32 字元。請用 `openssl rand -base64 48` 產生，或留空讓系統自動產生。')
    }
    return (keyCache = new TextEncoder().encode(fromEnv))
  }

  const path = keyPath()
  if (existsSync(/*turbopackIgnore: true*/ path)) {
    const v = readFileSync(/*turbopackIgnore: true*/ path, 'utf8').trim()
    if (v.length >= 32) return (keyCache = new TextEncoder().encode(v))
    log.warn('session 金鑰檔內容不合法，將重新產生', { path })
  }

  const generated = randomBytes(48).toString('base64')
  mkdirSync(/*turbopackIgnore: true*/ dirname(path), { recursive: true })
  writeFileSync(/*turbopackIgnore: true*/ path, generated, { mode: 0o600 })
  try {
    chmodSync(/*turbopackIgnore: true*/ path, 0o600)
  } catch {
    // 某些檔案系統（例如部分掛載的 volume）不支援 chmod，不是致命錯誤
  }
  log.info('已產生新的 session 金鑰', { path })
  return (keyCache = new TextEncoder().encode(generated))
}

/** 重新產生金鑰：所有已登入的裝置立刻登出。passkey 本身不受影響 */
export function regenerateSessionKey(): void {
  const path = keyPath()
  const generated = randomBytes(48).toString('base64')
  mkdirSync(/*turbopackIgnore: true*/ dirname(path), { recursive: true })
  writeFileSync(/*turbopackIgnore: true*/ path, generated, { mode: 0o600 })
  keyCache = new TextEncoder().encode(generated)
  log.warn('session 金鑰已重新產生，所有裝置已登出', { path })
}

function maxAgeSeconds(): number {
  return envInt('SESSION_MAX_AGE_DAYS', 30) * 86_400
}

/**
 * 瀏覽器會直接丟棄 http:// 來源上帶 Secure 的 cookie（localhost 除外）。
 * 硬寫 secure: true 在純 HTTP 下會變成「登入成功但立刻被踢回登入頁」，
 * 而且沒有任何錯誤訊息 —— 所以依實際協定判斷。
 */
async function useSecureCookie(): Promise<boolean> {
  const mode = (env('COOKIE_SECURE') ?? 'auto').toLowerCase()
  if (mode === 'true') return true
  if (mode === 'false') return false
  const h = await headers()
  return h.get('x-forwarded-proto') === 'https'
}

export async function issueSession(username: string, ver: number): Promise<void> {
  const maxAge = maxAgeSeconds()
  const jwt = await new SignJWT({ ver })
    .setProtectedHeader({ alg: 'HS256' }) // jose 沒有預設演算法，必須明寫
    .setSubject(username)
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${maxAge}s`)
    .sign(key())

  const secure = await useSecureCookie()
  const store = await cookies()
  store.set({
    name: secure ? SECURE_COOKIE : PLAIN_COOKIE,
    value: jwt,
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
}

export async function readSessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ['HS256'], // 明確鎖死，防 alg 混淆
      issuer: ISS,
      audience: AUD,
    })
    if (!payload.sub) return null
    return { username: payload.sub, ver: Number(payload.ver ?? 0) }
  } catch {
    return null
  }
}

export async function currentSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  const token = store.get(SECURE_COOKIE)?.value ?? store.get(PLAIN_COOKIE)?.value
  return readSessionToken(token)
}

export async function clearSession(): Promise<void> {
  const store = await cookies()
  for (const name of [SECURE_COOKIE, PLAIN_COOKIE]) {
    store.set({ name, value: '', httpOnly: true, path: '/', maxAge: 0 })
  }
}
