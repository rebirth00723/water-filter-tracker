import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto'

/**
 * 自己包 Promise 而不用 promisify：promisify 的型別只挑得到三參數的多載，
 * 帶 options 的四參數版本會推導失敗（TS2554）。
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err)
      else resolve(derived)
    })
  })
}

/**
 * 密碼雜湊。
 *
 * 用 node:crypto 的 scrypt 而非 Argon2 是為了**零原生相依** ——
 * 這個專案已經有 better-sqlite3 一個原生模組要顧，不值得為雜湊再加一個。
 * scrypt 是 RFC 7914 標準且 Node 內建。
 *
 * 參數：N=16384、r=8、p=1 → 記憶體用量 128*N*r = 16MB，
 * 在 Node 預設的 maxmem（32MB）之內，不必調整全域設定。
 */
const N = 16384
const R = 8
const P = 1
const KEY_LEN = 32
const SALT_LEN = 16

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const key = await scrypt(plain.normalize('NFKC'), salt, KEY_LEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

/**
 * 驗證密碼。任何格式問題一律回 false，不拋例外 ——
 * 呼叫端不該因為儲存格式壞掉而走到不同的分支（那會製造出可觀測的時間差）。
 */
export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false

  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nStr, rStr, pStr, saltB64, hashB64] = parts
  const n = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltB64, 'base64url')
    expected = Buffer.from(hashB64, 'base64url')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false

  try {
    const actual = await scrypt(plain.normalize('NFKC'), salt, expected.length, { N: n, r, p })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/**
 * 比較兩個字串（用於臨時密碼）。先雜湊再比較：
 * 長度不同時 timingSafeEqual 會直接丟例外，而長度本身就洩漏資訊。
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest()
  const hb = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(ha, hb)
}

/** 密碼強度下限。太弱的密碼在對外部署時是真實風險，但不要苛刻到讓人放棄設定 */
export const MIN_PASSWORD_LENGTH = 8

export function validatePassword(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元`
  }
  if (plain.length > 1024) return '密碼過長'
  return null
}
