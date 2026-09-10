import { describe, expect, it } from 'vitest'
import { computeDue } from '../due'
import { planFor } from './sweep'

const rule = (over: Partial<Parameters<typeof planFor>[0]> = {}) => ({
  id: 1,
  kind: 'ADVANCE' as const,
  offsetDays: 14,
  repeatDays: null,
  ...over,
})

/** 到期日 2026-09-21（今天 2026-09-07 時剩 14 天） */
const dueAt = (dueOn: string, today: string) => ({
  categoryId: 1,
  due: computeDue({
    cyclePeriod: 1,
    cycleUnit: 'DAY',
    lastReplacedOn: null,
    baselineOn: (() => {
      // 反推一個起算日讓 dueOn 剛好是想要的值
      const d = new Date(`${dueOn}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() - 1)
      return d.toISOString().slice(0, 10)
    })(),
    deviceInstalledOn: null,
    today,
  }),
})

describe('ADVANCE', () => {
  it('還沒到觸發日就不送', () => {
    // 到期 2026-09-21、提前 14 天 → 觸發日 2026-09-07
    expect(planFor(rule(), dueAt('2026-09-21', '2026-09-06'), '2026-09-06', 14)).toBeNull()
  })

  it('觸發日當天送，days 是剩餘天數', () => {
    const p = planFor(rule(), dueAt('2026-09-21', '2026-09-07'), '2026-09-07', 14)
    expect(p).toMatchObject({ kind: 'send', logKind: 'advance', days: 14, lateBy: 0 })
    // 去重鍵用到期日，所以同一個到期日只會送一次
    expect(p!.logDueOn).toBe('2026-09-21')
  })

  it('錯過幾天之後仍然補送，並記下遲了幾天', () => {
    // 機器關機三天，開機後那一次掃描要補上
    const p = planFor(rule(), dueAt('2026-09-21', '2026-09-10'), '2026-09-10', 14)
    expect(p).toMatchObject({ kind: 'send', days: 11, lateBy: 3 })
  })

  it('超過補送上限就改成略過並進彙總', () => {
    // 關機超過 14 天：不逐一補送，但要佔住 key，
    // 否則超齡項目每次掃描都會被重新算成「應送未送」
    const p = planFor(rule(), dueAt('2026-09-21', '2026-09-30'), '2026-09-30', 14)
    expect(p).toMatchObject({ kind: 'skip', logKind: 'advance', lateBy: 23 })
  })

  it('補送上限剛好等於遲到天數時仍然送', () => {
    const p = planFor(rule(), dueAt('2026-09-21', '2026-09-21'), '2026-09-21', 14)
    expect(p!.kind).toBe('send')
    expect(p).toMatchObject({ lateBy: 14 })
  })

  it('offsetDays 為 0 代表當天到期才提醒', () => {
    expect(planFor(rule({ offsetDays: 0 }), dueAt('2026-09-21', '2026-09-20'), '2026-09-20', 14))
      .toBeNull()
    const p = planFor(rule({ offsetDays: 0 }), dueAt('2026-09-21', '2026-09-21'), '2026-09-21', 14)
    expect(p).toMatchObject({ kind: 'send', days: 0 })
  })

  it('days 不會是負數 —— 已逾期時 ADVANCE 顯示 0 而不是負值', () => {
    const p = planFor(rule({ offsetDays: 3 }), dueAt('2026-09-21', '2026-09-25'), '2026-09-25', 14)
    expect(p!.kind).toBe('send')
    expect((p as { days: number }).days).toBe(0)
  })
})

describe('OVERDUE', () => {
  const overdueRule = rule({ kind: 'OVERDUE', offsetDays: null, repeatDays: 7 })

  it('還沒逾期就不送', () => {
    expect(planFor(overdueRule, dueAt('2026-09-21', '2026-09-07'), '2026-09-07', 14)).toBeNull()
  })

  it('逾期後第一次就送，days 是已逾期天數', () => {
    const p = planFor(overdueRule, dueAt('2026-09-01', '2026-09-07'), '2026-09-07', 14)
    expect(p).toMatchObject({ kind: 'send', logKind: 'overdue', days: 6 })
    // 逾期通知的去重鍵用「送出當日」，讓每一次重複各佔一列
    expect(p!.logDueOn).toBe('2026-09-07')
  })

  it('距上次送出未滿 repeatDays 就不送', () => {
    const p = planFor(overdueRule, dueAt('2026-09-01', '2026-09-07'), '2026-09-07', 14, '2026-09-03')
    expect(p).toBeNull()
  })

  it('滿了 repeatDays 就再送一次', () => {
    const p = planFor(overdueRule, dueAt('2026-09-01', '2026-09-10'), '2026-09-10', 14, '2026-09-03')
    expect(p).toMatchObject({ kind: 'send', days: 9 })
  })

  it('頻率算的是「距上次送出幾天」而不是取餘數', () => {
    /*
     * 取餘數（daysOverdue % repeat === 0）在機器剛好那一天沒開機時
     * 會永遠跳過那一輪 —— 而逾期提醒正是最不該漏掉的一種。
     * 這裡驗證：逾期第 8 天、上次在第 1 天送過，仍然會送（8-1=7 >= 7）
     */
    const p = planFor(overdueRule, dueAt('2026-09-01', '2026-09-09'), '2026-09-09', 14, '2026-09-02')
    expect(p!.kind).toBe('send')
  })

  it('repeatDays 未設時預設 7 天', () => {
    const noRepeat = rule({ kind: 'OVERDUE', offsetDays: null, repeatDays: null })
    expect(planFor(noRepeat, dueAt('2026-09-01', '2026-09-07'), '2026-09-07', 14, '2026-09-05'))
      .toBeNull()
    expect(planFor(noRepeat, dueAt('2026-09-01', '2026-09-13'), '2026-09-13', 14, '2026-09-05'))
      .not.toBeNull()
  })
})

describe('沒有到期日', () => {
  it('算不出到期日的種類完全不會產生通知', () => {
    const noDue = {
      categoryId: 1,
      due: computeDue({
        cyclePeriod: null,
        cycleUnit: 'MONTH' as const,
        lastReplacedOn: '2026-01-01',
        baselineOn: null,
        deviceInstalledOn: null,
        today: '2026-09-07',
      }),
    }
    expect(planFor(rule(), noDue, '2026-09-07', 14)).toBeNull()
    expect(planFor(rule({ kind: 'OVERDUE', repeatDays: 7 }), noDue, '2026-09-07', 14)).toBeNull()
  })
})

describe('審查發現的回歸測試', () => {
  it('planFor 回傳的 days 會被存下來，重試時不重算', () => {
    /*
     * 重試若重算 days，用的是「現在的到期狀態」——
     * 而那在使用者換了濾心或改了週期之後就變了，
     * 於是重試會送出一則數字完全對不上的訊息：
     * 「還有 14 天」變成「還有 87 天」，或者反過來。
     *
     * 這裡驗的是 plan 本身帶著 days（sweep 會把它寫進 notify_log.plannedDays，
     * retryFailed 再原樣取用）。
     */
    const p = planFor(rule(), dueAt('2026-09-21', '2026-09-07'), '2026-09-07', 14)
    expect(p).toMatchObject({ kind: 'send', days: 14 })
    expect(typeof (p as { days: number }).days).toBe('number')
  })
})
