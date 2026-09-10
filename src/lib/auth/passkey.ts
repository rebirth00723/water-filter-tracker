import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import { CONFIG_KEYS, getConfig, getPublicUrl, passkeyEligibility } from '../config'
import { db } from '../db'
import { credentials } from '../db/schema'
import { getPrimaryUser } from './store'

/**
 * passkey 的伺服端邏輯。
 *
 * **伺服器只存公鑰。** 資料庫外洩也無法用來登入 ——
 * 這與共享密鑰式的驗證（密碼、TOTP）是根本差異，也是把 passkey 放進來的理由。
 *
 * **註冊流程沒有任何 token、沒有 QR。** 先用密碼登入，再到
 * `(app)/settings/login` 註冊 —— 密碼登入本身就是授權。
 * 這個簡化的來源正是「有了密碼這個地板」。
 */

export type Credential = typeof credentials.$inferSelect

export interface RpConfig {
  rpID: string
  rpName: string
  origin: string
}

/**
 * RP 設定由 `PUBLIC_URL` 推導。
 *
 * RP ID 必須是**網域名稱** —— IP 位址不合法，而 WebAuthn 只在安全內容
 * （https 或 localhost）下存在。條件不滿足時回 null，呼叫端要顯示原因，
 * 而不是讓人操作到一半才發現瀏覽器拋錯。
 */
export function rpConfig(): RpConfig | null {
  if (!passkeyEligibility().eligible) return null
  const url = getPublicUrl()
  if (!url) return null
  const parsed = new URL(url)
  return {
    rpID: parsed.hostname,
    rpName: '淨水器記錄',
    // 含連接埠。WebAuthn 比對的是完整 origin，少了埠號在非標準埠上會失敗
    origin: parsed.origin,
  }
}

/** passkey 是否可用：條件滿足、管理員已開啟、而且**有密碼** */
export function passkeyUsable(): { ok: boolean; reason?: string } {
  const eligibility = passkeyEligibility()
  if (!eligibility.eligible) return { ok: false, reason: eligibility.reason }
  if (getConfig(CONFIG_KEYS.passkeyEnabled) !== 'true') {
    return { ok: false, reason: '管理中心尚未啟用 passkey' }
  }
  const user = getPrimaryUser()
  if (!user?.passwordHash) {
    /*
     * 啟用 passkey 就強制要有密碼，不能只有 passkey。
     * 理由是 passkey 綁定裝置與網域 —— 裝置遺失、換網域、
     * 或在沒有 HTTPS 的環境下都會失效，此時密碼是唯一的退路。
     */
    return { ok: false, reason: '尚未設定密碼。passkey 只能作為密碼之外的快捷方式' }
  }
  return { ok: true }
}

// ───────────────────────── 挑戰的暫存 ─────────────────────────

/**
 * 挑戰暫存在記憶體。
 *
 * 這是刻意的：單一 process、單一使用者，而挑戰的生命週期只有幾十秒。
 * 重啟會讓「正在進行中」的那一次註冊或登入失敗，使用者重試一次就好 ——
 * 為此引入一張資料表或一個簽章 cookie，換到的可靠性不值得那些複雜度。
 */
const CHALLENGE_TTL_MS = 120_000
type Purpose = 'register' | 'login'

const KEY = Symbol.for('ro-tracker.webauthn-challenges')
const g = globalThis as unknown as Record<symbol, Map<string, { value: string; at: number }> | undefined>
const store = (): Map<string, { value: string; at: number }> => (g[KEY] ??= new Map())

function slot(purpose: Purpose, username: string) {
  return `${purpose}:${username}`
}

/**
 * 登入挑戰可以同時存在數個。
 *
 * 產生登入挑戰的 GET 端點**不需要驗證**（那是它的用途），
 * 所以單一槽位的話，任何人打一次那個端點就會把使用者進行中的登入挑戰洗掉 ——
 * 使用者按了 Face ID 卻得到「挑戰已逾時」。
 * 保留最近幾個，逾時的自然淘汰。
 */
const MAX_LOGIN_CHALLENGES = 8

export function saveChallenge(purpose: Purpose, username: string, value: string): void {
  const s = store()
  if (purpose === 'login') {
    // 順手清掉過期的，避免這張表無限成長
    const cutoff = Date.now() - CHALLENGE_TTL_MS
    for (const [k, v] of s) {
      if (k.startsWith('login:') && v.at < cutoff) s.delete(k)
    }
    const live = [...s.keys()].filter((k) => k.startsWith('login:'))
    if (live.length >= MAX_LOGIN_CHALLENGES) s.delete(live[0])
    s.set(`login:${username}:${value.slice(0, 12)}`, { value, at: Date.now() })
    return
  }
  s.set(slot(purpose, username), { value, at: Date.now() })
}

/**
 * 取出並**立即刪除** —— 挑戰是一次性的，重放必須失敗。
 *
 * 登入時傳入 `expected`（客戶端回傳的挑戰值）以命中正確的那一個槽位；
 * 註冊只有一個進行中的流程，所以用固定槽位即可。
 */
export function takeChallenge(
  purpose: Purpose,
  username: string,
  expected?: string,
): string | null {
  const s = store()
  const key =
    purpose === 'login' && expected
      ? `login:${username}:${expected.slice(0, 12)}`
      : slot(purpose, username)
  const hit = s.get(key)
  s.delete(key)
  if (!hit) return null
  if (Date.now() - hit.at > CHALLENGE_TTL_MS) return null
  // 比對完整的值，不只是被當作 key 的前 12 字元
  if (expected !== undefined && hit.value !== expected) return null
  return hit.value
}

// ───────────────────────── 憑證 ─────────────────────────

export function listCredentials(username: string): Credential[] {
  return db
    .select()
    .from(credentials)
    .where(eq(credentials.username, username))
    .orderBy(asc(credentials.createdAt))
    .all()
}

export function countCredentials(username: string): number {
  return listCredentials(username).length
}

export function findCredential(credentialId: string): Credential | undefined {
  return db.select().from(credentials).where(eq(credentials.credentialId, credentialId)).get()
}

export function saveCredential(input: {
  username: string
  credentialId: string
  publicKey: string
  counter: number
  transports: string[] | undefined
  deviceLabel: string | null
}): Credential {
  return db
    .insert(credentials)
    .values({
      username: input.username,
      credentialId: input.credentialId,
      publicKey: input.publicKey,
      counter: input.counter,
      transports: input.transports?.length ? JSON.stringify(input.transports) : null,
      deviceLabel: input.deviceLabel,
    })
    .returning()
    .get()
}

export function bumpCounter(credentialId: string, counter: number): void {
  db.update(credentials)
    .set({ counter, lastUsedAt: Date.now() })
    .where(eq(credentials.credentialId, credentialId))
    .run()
}

export function deleteCredential(username: string, id: number): Credential | undefined {
  const row = db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.username, username)))
    .get()
  if (!row) return undefined
  db.delete(credentials).where(eq(credentials.id, id)).run()
  return row
}

export function renameCredential(
  username: string,
  id: number,
  label: string,
): Credential | undefined {
  return db
    .update(credentials)
    .set({ deviceLabel: label })
    .where(and(eq(credentials.id, id), eq(credentials.username, username)))
    .returning()
    .get()
}

/** 換網域時所有 passkey 都失效，提供一鍵清空 */
export function deleteAllCredentials(username: string): number {
  const n = countCredentials(username)
  db.delete(credentials).where(eq(credentials.username, username)).run()
  return n
}

/**
 * 規範定義的傳輸方式。
 *
 * 在解析時就收窄型別，而不是回 `string[]` 再到呼叫端 `as never` ——
 * 那個轉型會讓「資料庫裡存了一個規範沒有的值」這件事無聲通過，
 * 然後在瀏覽器端變成一個很難查的 WebAuthn 錯誤。
 * 認不出來的值直接丟掉：transports 只是給瀏覽器的提示，少一個不影響登入。
 */
const KNOWN_TRANSPORTS = [
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
] as const

export type Transport = (typeof KNOWN_TRANSPORTS)[number]

export function parseTransports(json: string | null): Transport[] {
  if (!json) return []
  try {
    const v: unknown = JSON.parse(json)
    if (!Array.isArray(v)) return []
    return v.filter((x): x is Transport =>
      (KNOWN_TRANSPORTS as readonly unknown[]).includes(x),
    )
  } catch {
    return []
  }
}
