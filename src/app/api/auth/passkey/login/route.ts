import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { audit } from '@/lib/audit'
import { clientIp, userAgent } from '@/lib/auth/client-ip'
import { LOGIN_FAILED } from '@/lib/auth/messages'
import {
  bumpCounter,
  findCredential,
  listCredentials,
  parseTransports,
  passkeyUsable,
  rpConfig,
  saveChallenge,
  takeChallenge,
} from '@/lib/auth/passkey'
import { issueSession } from '@/lib/auth/session'
import { getPrimaryUser, recordLogin } from '@/lib/auth/store'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

function bad(message: string, status = 400) {
  return Response.json({ ok: false, message }, { status })
}

/** 從 base64url 的 clientDataJSON 取出 challenge。壞掉的輸入回 undefined，由後續流程拒絕 */
function challengeFromClientData(clientDataJSON: string | undefined): string | undefined {
  if (!clientDataJSON) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'))
    const c = (parsed as { challenge?: unknown })?.challenge
    return typeof c === 'string' ? c : undefined
  } catch {
    return undefined
  }
}

/**
 * passkey 登入。
 *
 * **這個端點不需要既有的 session** —— 那正是它的用途。
 * 安全性來自挑戰回應：伺服器只有公鑰，驗簽通過代表對方持有私鑰，
 * 而私鑰從來沒有離開使用者的裝置。
 *
 * 因此**這裡不需要限流**：沒有可暴力破解的空間，
 * 每一次嘗試都要一個由伺服器產生的一次性挑戰的有效簽章。
 * 密碼那條路才需要限流（見 api/auth/login）。
 */
export async function GET() {
  const usable = passkeyUsable()
  if (!usable.ok) return bad(usable.reason ?? 'passkey 目前不可用', 409)

  const rp = rpConfig()
  const user = getPrimaryUser()
  if (!rp || !user) return bad('passkey 目前不可用', 409)

  const creds = listCredentials(user.username)
  if (creds.length === 0) return bad('這個帳號還沒有註冊任何 passkey', 409)

  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
    userVerification: 'preferred',
  })

  saveChallenge('login', user.username, options.challenge)
  return Response.json({ ok: true, options })
}

export async function POST(req: Request) {
  const usable = passkeyUsable()
  if (!usable.ok) return bad(usable.reason ?? 'passkey 目前不可用', 409)

  const rp = rpConfig()
  const user = getPrimaryUser()
  if (!rp || !user) return bad('passkey 目前不可用', 409)

  const body = (await req.json().catch(() => null)) as
    | { response?: AuthenticationResponseJSON }
    | null
  if (!body?.response || typeof body.response !== 'object') {
    return bad('缺少驗證器的回應')
  }

  /*
   * 從 clientDataJSON 取出這次回應對應的挑戰值，用來命中正確的槽位。
   *
   * 這個值來自客戶端，但**不構成信任問題**：takeChallenge 會比對完整的值，
   * 而 verifyAuthenticationResponse 又會拿它與簽章一起驗。
   * 這裡只是用它「找到是哪一個進行中的挑戰」，
   * 好處是別人打一次 GET 端點不會洗掉你進行中的那一個。
   */
  const presented = challengeFromClientData(body.response.response?.clientDataJSON)
  const expectedChallenge = takeChallenge('login', user.username, presented)
  if (!expectedChallenge) return bad('挑戰已逾時，請重新嘗試', 410)

  const [ip, ua] = await Promise.all([clientIp(), userAgent()])
  const stored = findCredential(body.response.id)
  if (!stored || stored.username !== user.username) {
    audit({
      action: 'login.fail.passkey_unknown',
      username: user.username,
      ip,
      userAgent: ua,
      summary: 'passkey 登入失敗：憑證不在名單內（可能已被撤銷）',
    })
    return bad(LOGIN_FAILED)
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
        counter: stored.counter,
        transports: parseTransports(stored.transports),
      },
    })
  } catch (err) {
    audit({
      action: 'login.fail.passkey_verify',
      username: user.username,
      ip,
      userAgent: ua,
      summary: `passkey 驗簽失敗：${(err as Error).message}`,
    })
    return bad(LOGIN_FAILED)
  }

  if (!verification.verified) {
    audit({
      action: 'login.fail.passkey_verify',
      username: user.username,
      ip,
      userAgent: ua,
      summary: 'passkey 驗簽未通過',
    })
    return bad(LOGIN_FAILED)
  }

  /*
   * 更新 counter。
   *
   * 這是 WebAuthn 的重放防護：驗證器每次簽章都會遞增計數器，
   * 而 simplewebauthn 會在計數器倒退時拒絕（代表憑證被複製）。
   * 不更新的話這層保護就形同關閉。
   *
   * 注意：多數 passkey（同步到 iCloud／Google 的那種）計數器恆為 0，
   * 規範明訂此時不做比對 —— 所以這裡不能自己加「必須遞增」的檢查。
   */
  bumpCounter(stored.credentialId, verification.authenticationInfo.newCounter)
  recordLogin(user.username)

  const fresh = getPrimaryUser()
  await issueSession(user.username, fresh?.tokenVersion ?? 1)

  // 一般登入成功刻意不推播 —— 每天登入就每天響，那是雜訊不是訊號
  audit({
    action: 'login.ok.passkey',
    username: user.username,
    ip,
    userAgent: ua,
    summary: `以 passkey「${stored.deviceLabel ?? '未命名'}」登入成功`,
  })
  log.info('passkey 登入成功', { user: user.username })

  return Response.json({ ok: true })
}
