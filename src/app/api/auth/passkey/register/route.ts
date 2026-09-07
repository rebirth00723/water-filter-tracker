import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { audit } from '@/lib/audit'
import { clientIp, userAgent } from '@/lib/auth/client-ip'
import {
  countCredentials,
  listCredentials,
  parseTransports,
  passkeyUsable,
  rpConfig,
  saveChallenge,
  saveCredential,
  takeChallenge,
} from '@/lib/auth/passkey'
import { currentSession } from '@/lib/auth/session'
import { getAuthMode, getPrimaryUser } from '@/lib/auth/store'
import { log } from '@/lib/log'
import { sendNtfyQuiet } from '@/lib/notify/ntfy'

export const dynamic = 'force-dynamic'

function bad(message: string, status = 400) {
  return Response.json({ ok: false, message }, { status })
}

/**
 * 註冊 passkey。
 *
 * **必須已登入。** 密碼登入本身就是授權 —— 這是整個設計的簡化來源：
 * 有了密碼這個地板，註冊就不需要 token、不需要 QR、不需要第二個埠。
 * 若這個端點出現任何 token 或 QR 的痕跡，代表退回了舊設計。
 */
async function requireLoggedIn(): Promise<{ username: string } | null> {
  const mode = getAuthMode()
  const user = getPrimaryUser()
  if (!user) return null
  // 無密碼模式下不可能啟用 passkey（passkeyUsable 會擋），這裡只是防禦性檢查
  if (mode === 'open') return null
  const session = await currentSession()
  if (!session || session.username !== user.username) return null
  if (session.ver !== user.tokenVersion) return null
  return { username: user.username }
}

/** 產生註冊挑戰 */
export async function GET() {
  const me = await requireLoggedIn()
  if (!me) return bad('請先登入', 401)

  const usable = passkeyUsable()
  if (!usable.ok) return bad(usable.reason ?? 'passkey 目前不可用', 409)

  const rp = rpConfig()
  if (!rp) return bad('無法推導 passkey 的網域設定，請檢查對外網址', 409)

  const existing = listCredentials(me.username)
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: me.username,
    // 排除已註冊的，讓同一把鑰匙不會被註冊兩次
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
    authenticatorSelection: {
      // preferred 而不是 required：要求 residentKey 會排除一部分安全金鑰，
      // 而這個 App 的使用者大多用手機的內建驗證器
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  saveChallenge('register', me.username, options.challenge)
  return Response.json({ ok: true, options })
}

/** 驗簽並存下公鑰 */
export async function POST(req: Request) {
  const me = await requireLoggedIn()
  if (!me) return bad('請先登入', 401)

  const usable = passkeyUsable()
  if (!usable.ok) return bad(usable.reason ?? 'passkey 目前不可用', 409)

  const rp = rpConfig()
  if (!rp) return bad('無法推導 passkey 的網域設定', 409)

  /*
   * 用函式庫自己的型別，不用 any。
   *
   * 這個 payload 來自 `@simplewebauthn/browser` 的 startRegistration()，
   * 形狀由規範決定，而**內容的合法性由 verifyRegistrationResponse 驗** ——
   * 它對格式不符的輸入會 throw，而那個 throw 已經被下面接住並轉成 400。
   * 所以這裡只需要一個「是不是物件」的執行期護欄，不需要重寫一份 CBOR 驗證。
   */
  const body = (await req.json().catch(() => null)) as
    | { response?: RegistrationResponseJSON; label?: unknown }
    | null
  if (!body?.response || typeof body.response !== 'object') {
    return bad('缺少驗證器的回應')
  }

  const expectedChallenge = takeChallenge('register', me.username)
  if (!expectedChallenge) {
    return bad('挑戰已逾時或不存在，請重新開始註冊', 410)
  }

  const [ip, ua] = await Promise.all([clientIp(), userAgent()])

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
    })
  } catch (err) {
    audit({
      action: 'passkey.register.fail',
      username: me.username,
      ip,
      userAgent: ua,
      summary: `passkey 註冊驗簽失敗：${(err as Error).message}`,
    })
    return bad(`驗簽失敗：${(err as Error).message}`)
  }

  if (!verification.verified) {
    audit({
      action: 'passkey.register.fail',
      username: me.username,
      ip,
      userAgent: ua,
      summary: 'passkey 註冊驗簽未通過',
    })
    return bad('驗簽未通過')
  }

  const { credential } = verification.registrationInfo
  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 40)
      : guessLabel(ua)

  const saved = saveCredential({
    username: me.username,
    credentialId: credential.id,
    // 只存公鑰。base64url 是因為 SQLite 的 TEXT 欄位不適合放二進位
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports,
    deviceLabel: label,
  })

  audit({
    action: 'passkey.register.ok',
    username: me.username,
    ip,
    userAgent: ua,
    entity: 'credential',
    entityId: saved.id,
    summary: `新增 passkey「${label}」（目前共 ${countCredentials(me.username)} 把）`,
  })

  /*
   * 新 passkey 註冊成功要推播，優先度 4。
   *
   * 這是最該立刻知道的事 —— 有人多了一把能從外面進來的鑰匙。
   * 而一般登入成功刻意**不推播**：每天登入就每天響，那是雜訊不是訊號。
   * 「新裝置」的情況已由這一則涵蓋，因為有了 passkey 之後每一筆憑證就是一台裝置。
   */
  void sendNtfyQuiet({
    channel: 'security',
    title: '新增了一把 passkey',
    message: `「${label}」已註冊到 ${me.username}。若不是你本人操作，請立刻到管理中心撤銷並更換密碼。`,
    priority: 4,
    tags: ['key'],
  })

  log.info('passkey 註冊成功', { user: me.username, label })
  return Response.json({ ok: true, id: saved.id, label })
}

/** 從 User-Agent 猜一個看得懂的裝置名稱。使用者可以在清單裡改 */
function guessLabel(ua: string): string {
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android 裝置'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows 電腦'
  return '未命名裝置'
}
