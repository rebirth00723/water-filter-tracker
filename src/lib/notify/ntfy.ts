import { env } from '../env'

export type NtfyPriority = 1 | 2 | 3 | 4 | 5

export interface NtfyMessage {
  /** 覆寫預設 topic（每台設備可有專屬 topic） */
  topic?: string
  title?: string
  message: string
  tags?: string[]
  priority?: NtfyPriority
  /** 點擊通知後開啟的網址 */
  click?: string
}

export type NtfyErrorKind = 'config' | 'timeout' | 'network' | 'auth' | 'ratelimit' | 'http'

export class NtfyError extends Error {
  constructor(
    message: string,
    readonly kind: NtfyErrorKind,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'NtfyError'
  }
}

/** 官方允許字元：英數字、- 與 _，最長 64 */
const TOPIC_RE = /^[-_A-Za-z0-9]{1,64}$/

function authHeader(): string | undefined {
  const token = env('NTFY_TOKEN')
  if (token) return `Bearer ${token}`
  const user = env('NTFY_USER')
  const password = env('NTFY_PASSWORD')
  if (user && password) {
    return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`
  }
  return undefined
}

export function resolveTopic(override?: string | null): string | undefined {
  return override?.trim() || env('NTFY_TOPIC')
}

/**
 * 送出 ntfy 通知。
 *
 * 【一律用 JSON 發布端點，POST 到「根路徑」而非 /<topic>】
 * 原因是 Node 的 fetch 依 WHATWG 規範強制 header value 為 ByteString，
 * 中文標題放進 X-Title 會直接拋 TypeError（不是顯示成問號而已）。
 * JSON body 沒有這個限制。
 */
export async function sendNtfy(
  msg: NtfyMessage,
  opts: { timeoutMs?: number } = {},
): Promise<{ id: string; topic: string }> {
  const timeoutMs = opts.timeoutMs ?? 8000
  const base = env('NTFY_URL')?.replace(/\/+$/, '')
  const topic = resolveTopic(msg.topic)

  if (!base) {
    throw new NtfyError('尚未設定 NTFY_URL，請在 docker-compose.yml 填入 ntfy 伺服器網址', 'config')
  }
  if (!topic) {
    throw new NtfyError('尚未設定 NTFY_TOPIC，也沒有指定設備專屬 topic', 'config')
  }
  if (!TOPIC_RE.test(topic)) {
    throw new NtfyError(
      `topic 名稱「${topic}」不合法：只能使用英文字母、數字、- 與 _，最長 64 字元`,
      'config',
    )
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const auth = authHeader()
  if (auth) headers.Authorization = auth

  let res: Response
  try {
    res = await fetch(`${base}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        topic,
        message: msg.message,
        ...(msg.title ? { title: msg.title } : {}),
        ...(msg.tags?.length ? { tags: msg.tags } : {}),
        ...(msg.priority ? { priority: msg.priority } : {}),
        ...(msg.click ? { click: msg.click } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new NtfyError(
        `連線 ${base} 逾時（${timeoutMs}ms）。請確認 ntfy 伺服器是否運作中、網址是否正確。`,
        'timeout',
      )
    }
    const cause = (err as { cause?: { code?: string } }).cause?.code
    const hint =
      cause === 'ENOTFOUND'
        ? '找不到主機，請檢查網域名稱或容器網路設定。'
        : cause === 'ECONNREFUSED'
          ? '連線被拒絕，ntfy 可能沒有啟動，或連接埠不對。'
          : cause === 'CERT_HAS_EXPIRED' || cause === 'DEPTH_ZERO_SELF_SIGNED_CERT'
            ? 'TLS 憑證驗證失敗（自簽憑證？）。'
            : ''
    throw new NtfyError(
      `無法連線到 ${base}：${cause ?? (err as Error).message}。${hint}`,
      'network',
    )
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200)
    if (res.status === 401 || res.status === 403) {
      throw new NtfyError(
        `ntfy 驗證失敗（HTTP ${res.status}）。請檢查帳號密碼或 token，` +
          `並確認該帳號對 topic「${topic}」有 write 權限。`,
        'auth',
        res.status,
      )
    }
    if (res.status === 429) {
      throw new NtfyError('ntfy 伺服器目前限流中（HTTP 429），請稍後再試。', 'ratelimit', 429)
    }
    if (res.status === 404) {
      throw new NtfyError(
        `ntfy 回應 404。最常見的原因是 NTFY_URL 誤填成含 topic 的網址 —— ` +
          `JSON 發布必須送到根路徑（目前送往 ${base}/）。`,
        'http',
        404,
      )
    }
    throw new NtfyError(`ntfy 回應 HTTP ${res.status}：${text || '(無回應內容)'}`, 'http', res.status)
  }

  return (await res.json()) as { id: string; topic: string }
}

/** 通知失敗絕不能讓主要流程跟著失敗 */
export async function sendNtfyQuiet(msg: NtfyMessage): Promise<void> {
  const { log } = await import('../log')
  try {
    await sendNtfy(msg)
  } catch (err) {
    log.warn('ntfy 推播失敗', { err, title: msg.title })
  }
}
