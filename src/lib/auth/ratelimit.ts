/**
 * 登入限流。刻意只以「帳號」為 key，不看 IP：
 *
 * 防枚舉靠的是「所有失敗回應完全一致 + 固定回應時間下限」，不是 IP 限流。
 * 而對不存在的帳號無限嘗試沒有意義 —— 它永遠不可能通過。因此呼叫端只對
 * 「確實存在的帳號」建立計數器，計數器數量天生被設定的帳號數限制住，
 * 不需要容量上限與淘汰邏輯。
 *
 * 計數器只存在記憶體：重啟容器即全部解鎖，這是刻意保留的自救後門。
 */
export interface RateLimitConfig {
  /** 節流視窗（毫秒） */
  windowMs: number
  /** 視窗內最多幾次嘗試 */
  maxInWindow: number
  /** 累計幾次失敗即鎖定 */
  lockThreshold: number
  /** 鎖定多久（毫秒） */
  lockMs: number
  /** 失敗紀錄保留多久 */
  failureTtlMs: number
}

export const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 30_000,
  maxInWindow: 2,
  lockThreshold: 4,
  lockMs: 10 * 60_000,
  failureTtlMs: 10 * 60_000,
}

interface Bucket {
  attempts: number[]
  failures: number[]
  lockedUntil: number
  lastSubmissionHash?: string
  lastSubmissionAt?: number
}

export type Verdict =
  | { allowed: true }
  | { allowed: false; reason: 'locked' | 'throttled' | 'duplicate'; retryAfterMs: number }

export interface CheckOptions {
  /**
   * 逃生路：持有 RECOVERY_CODE 時，同時略過「鎖定」與「節流」的拒絕。
   *
   * 【為什麼連節流也要略過】只略過鎖定的話，這條逃生路在它最該生效的情境
   * 反而失效：攻擊者持續敲擊會讓 30 秒的節流視窗一直是滿的，
   * 持有逃生碼的本人照樣被擋在外面。持有 48 字元逃生碼的人不需要被限流保護，
   * 而 TOTP 仍然是必須通過的關卡 —— 繞過的是限流，不是驗證。
   *
   * 失敗仍照常累計，因此對「沒有逃生碼的一般嘗試」而言鎖會重新扣上。
   */
  bypass?: boolean
}

export function createRateLimiter(
  config: RateLimitConfig = DEFAULT_CONFIG,
  clock: () => number = Date.now,
) {
  const buckets = new Map<string, Bucket>()

  function touch(username: string): Bucket {
    const now = clock()
    let b = buckets.get(username)
    if (!b) {
      b = { attempts: [], failures: [], lockedUntil: 0 }
      buckets.set(username, b)
    }
    // 惰性修剪
    b.attempts = b.attempts.filter((t) => now - t < config.windowMs)
    b.failures = b.failures.filter((t) => now - t < config.failureTtlMs)
    if (b.lockedUntil && b.lockedUntil <= now) {
      b.lockedUntil = 0
      b.failures = []
    }
    return b
  }

  function recordFailure(b: Bucket) {
    const now = clock()
    b.failures.push(now)
    if (b.failures.length >= config.lockThreshold) {
      b.lockedUntil = now + config.lockMs
      b.failures = [] // 鎖定後歸零，解鎖時重新開始數
    }
  }

  return {
    /**
     * @param submissionHash sha256(帳號 + '\0' + 驗證碼)，用來辨識「同一次送出」
     */
    check(username: string, submissionHash: string, opts: CheckOptions = {}): Verdict {
      const now = clock()
      const b = touch(username)

      // 1. 已鎖定 → 直接拒絕，且【不再累加失敗次數】。
      //    否則持續敲擊就能無限延長鎖定，讓本人永遠等不到解鎖。
      if (b.lockedUntil > now && !opts.bypass) {
        return { allowed: false, reason: 'locked', retryAfterMs: b.lockedUntil - now }
      }

      // 2. 同一組（帳號, 驗證碼）在視窗內重送視為同一次：
      //    擋掉雙擊送出、網路重試、按 F5 重送表單 —— 這在手機上很常見，
      //    沒有這層保護會白白燒掉鎖定額度。
      if (
        b.lastSubmissionHash === submissionHash &&
        b.lastSubmissionAt !== undefined &&
        now - b.lastSubmissionAt < config.windowMs
      ) {
        return {
          allowed: false,
          reason: 'duplicate',
          retryAfterMs: config.windowMs - (now - b.lastSubmissionAt),
        }
      }

      // 3. 節流：視窗內已達上限。
      //    【被節流的嘗試計入那 4 次】—— 否則攻擊者全速噴射時只有前 2 次
      //    真正被驗證，鎖定門檻永遠碰不到，防護退化成單純的 2 次/30 秒。
      if (b.attempts.length >= config.maxInWindow && !opts.bypass) {
        const oldest = b.attempts[0]
        b.attempts.push(now)
        b.lastSubmissionHash = submissionHash
        b.lastSubmissionAt = now
        recordFailure(b)
        return {
          allowed: false,
          reason: 'throttled',
          retryAfterMs: Math.max(0, config.windowMs - (now - oldest)),
        }
      }

      b.attempts.push(now)
      b.lastSubmissionHash = submissionHash
      b.lastSubmissionAt = now
      return { allowed: true }
    },

    /** 驗證失敗時呼叫 */
    fail(username: string) {
      recordFailure(touch(username))
    },

    /** 驗證成功時呼叫：整個計數器清掉 */
    succeed(username: string) {
      buckets.delete(username)
    },

    /** 供 log 使用：回傳鎖定到期的 epoch ms，未鎖定則為 0 */
    lockedUntil(username: string): number {
      return buckets.get(username)?.lockedUntil ?? 0
    },

    /** 測試與診斷用 */
    size() {
      return buckets.size
    },
  }
}

export type RateLimiter = ReturnType<typeof createRateLimiter>

const KEY = Symbol.for('ro-tracker.ratelimit')
const g = globalThis as unknown as Record<symbol, RateLimiter | undefined>

/** process 內唯一的實例。重啟即歸零 —— 這是刻意的 */
export const rateLimiter: RateLimiter = g[KEY] ?? (g[KEY] = createRateLimiter())
