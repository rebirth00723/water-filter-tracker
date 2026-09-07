import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, createRateLimiter } from './ratelimit'

/** 假時鐘：限流是時間相依的邏輯，用真實時間測會又慢又不穩 */
function withClock() {
  let now = 1_700_000_000_000
  const clock = () => now
  return {
    clock,
    advance: (ms: number) => {
      now += ms
    },
    get now() {
      return now
    },
  }
}

const HASH_A = 'hash-a'
const HASH_B = 'hash-b'
const HASH_C = 'hash-c'

describe('登入限流', () => {
  it('視窗內前 2 次放行，第 3 次被節流', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)

    expect(rl.check('rose', HASH_A).allowed).toBe(true)
    expect(rl.check('rose', HASH_B).allowed).toBe(true)
    const third = rl.check('rose', HASH_C)
    expect(third.allowed).toBe(false)
    expect(third.allowed === false && third.reason).toBe('throttled')
  })

  it('視窗過去後額度回復', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)

    rl.check('rose', HASH_A)
    rl.check('rose', HASH_B)
    t.advance(30_001)
    expect(rl.check('rose', HASH_C).allowed).toBe(true)
  })

  it('累計 4 次失敗即鎖定 10 分鐘', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)

    // 每次都拉開視窗，確保是「真正被驗證後失敗」而非被節流
    for (let i = 0; i < 4; i++) {
      const v = rl.check('rose', `h${i}`)
      expect(v.allowed).toBe(true)
      rl.fail('rose')
      t.advance(31_000)
    }

    const v = rl.check('rose', 'h9')
    expect(v.allowed).toBe(false)
    expect(v.allowed === false && v.reason).toBe('locked')
    expect(v.allowed === false && v.retryAfterMs).toBeGreaterThan(9 * 60_000)
  })

  it('鎖定期間持續敲擊不會延長鎖定', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)

    for (let i = 0; i < 4; i++) {
      rl.check('rose', `h${i}`)
      rl.fail('rose')
      t.advance(31_000)
    }
    const first = rl.check('rose', 'x')
    const until = t.now + (first.allowed === false ? first.retryAfterMs : 0)

    // 鎖定期間狂敲 20 次
    for (let i = 0; i < 20; i++) {
      t.advance(1_000)
      rl.check('rose', `spam${i}`)
    }
    const later = rl.check('rose', 'y')
    expect(later.allowed).toBe(false)
    // 到期時間沒有被往後推
    expect(t.now + (later.allowed === false ? later.retryAfterMs : 0)).toBe(until)
  })

  it('鎖定到期後自動解鎖，且額度重新開始', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)

    for (let i = 0; i < 4; i++) {
      rl.check('rose', `h${i}`)
      rl.fail('rose')
      t.advance(31_000)
    }
    expect(rl.check('rose', 'x').allowed).toBe(false)

    t.advance(10 * 60_000 + 1)
    expect(rl.check('rose', 'after-unlock').allowed).toBe(true)
  })

  it('被節流的嘗試計入鎖定額度（否則全速噴射永遠碰不到門檻）', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)

    // 不推進時間，連續送出不同的驗證碼
    const reasons: string[] = []
    for (let i = 0; i < 7; i++) {
      const v = rl.check('rose', `code${i}`)
      if (v.allowed === false) reasons.push(v.reason)
    }

    // 前 2 次放行；第 3-6 次被節流，而節流本身也累計失敗，
    // 第 4 次累計（即第 6 次呼叫）扣上鎖，第 7 次呼叫才會看到 locked。
    expect(reasons).toEqual([
      'throttled', 'throttled', 'throttled', 'throttled', 'locked',
    ])

    // 關鍵性質：完全不推進時間、只靠節流，就足以在 7 次呼叫內鎖住帳號。
    // 若節流不計入額度，這裡會永遠停在 throttled，鎖定門檻永遠碰不到。
    expect(rl.lockedUntil('rose')).toBeGreaterThan(t.now)
  })

  it('完全相同的送出在視窗內視為同一次，不燒額度', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)

    expect(rl.check('rose', HASH_A).allowed).toBe(true)
    // 雙擊送出：同一組帳號與驗證碼
    const dup = rl.check('rose', HASH_A)
    expect(dup.allowed).toBe(false)
    expect(dup.allowed === false && dup.reason).toBe('duplicate')

    // 額度沒被燒掉：換一組驗證碼仍然放行
    expect(rl.check('rose', HASH_B).allowed).toBe(true)
  })

  it('成功登入後計數器完全清空', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)

    rl.check('rose', HASH_A)
    rl.fail('rose')
    t.advance(31_000)
    rl.check('rose', HASH_B)
    rl.succeed('rose')

    expect(rl.size()).toBe(0)
    expect(rl.check('rose', HASH_C).allowed).toBe(true)
  })

  it('不同帳號互不影響', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)

    for (let i = 0; i < 4; i++) {
      rl.check('rose', `h${i}`)
      rl.fail('rose')
      t.advance(31_000)
    }
    expect(rl.check('rose', 'x').allowed).toBe(false)
    expect(rl.check('alice', 'x').allowed).toBe(true)
  })

  it('RECOVERY_CODE 略過鎖定，但失敗仍累計、鎖會重新扣上', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)

    for (let i = 0; i < 4; i++) {
      rl.check('rose', `h${i}`)
      rl.fail('rose')
      t.advance(31_000)
    }
    expect(rl.check('rose', 'x').allowed).toBe(false)

    // 帶著逃生碼可以繼續嘗試
    expect(rl.check('rose', 'recover-1', { bypass: true }).allowed).toBe(true)

    // 但它不是免死金牌：再失敗 4 次照樣重新鎖上
    for (let i = 0; i < 4; i++) {
      rl.check('rose', `r${i}`, { bypass: true })
      rl.fail('rose')
      t.advance(31_000)
    }
    expect(rl.lockedUntil('rose')).toBeGreaterThan(t.now)
  })

  it('逃生碼也必須略過「節流」，否則攻擊進行中它就形同虛設', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)

    // 模擬攻擊者持續敲擊，把 30 秒節流視窗塞滿
    for (let i = 0; i < 6; i++) rl.check('rose', `attacker${i}`)

    // 本人帶著逃生碼要進來 —— 若只略過鎖定，這裡會回 throttled，
    // 逃生路在它最該生效的情境反而失效。
    const rescue = rl.check('rose', 'owner-code', { bypass: true })
    expect(rescue.allowed).toBe(true)
  })

  it('只在呼叫端確認帳號存在時才建立計數器（記憶體有界）', () => {
    const t = withClock()
    const rl = createRateLimiter(DEFAULT_CONFIG, t.clock)
    rl.check('rose', HASH_A)
    rl.check('alice', HASH_A)
    // 不存在的帳號由呼叫端擋下，根本不會進到這裡
    expect(rl.size()).toBe(2)
  })
})
