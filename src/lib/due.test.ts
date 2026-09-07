import { describe, expect, it } from 'vitest'
import { computeDue, dueStatus, dueStatusLabel, type DueInput } from './due'

const base: DueInput = {
  cyclePeriod: 3,
  cycleUnit: 'MONTH',
  lastReplacedOn: null,
  baselineOn: null,
  deviceInstalledOn: null,
  today: '2026-09-07',
}

describe('四階梯的優先順序', () => {
  it('1. 有更換紀錄就用它', () => {
    const r = computeDue({
      ...base,
      lastReplacedOn: '2026-08-01',
      baselineOn: '2026-01-01',
      deviceInstalledOn: '2025-01-01',
    })
    expect(r.basis).toBe('REPLACE')
    expect(r.since).toBe('2026-08-01')
    expect(r.dueOn).toBe('2026-11-01')
  })

  it('2. 沒有更換紀錄時用種類的起算日', () => {
    const r = computeDue({ ...base, baselineOn: '2026-06-15', deviceInstalledOn: '2025-01-01' })
    expect(r.basis).toBe('BASELINE')
    expect(r.dueOn).toBe('2026-09-15')
  })

  it('3. 兩者都沒有時用設備裝機日', () => {
    const r = computeDue({ ...base, deviceInstalledOn: '2026-07-31' })
    expect(r.basis).toBe('DEVICE_INSTALL')
    expect(r.dueOn).toBe('2026-10-31')
  })

  it('4. 都沒有時回 null，絕不編一個假的到期日', () => {
    // 錯的到期日比沒有到期日更糟：沒有時使用者知道要去設起算日，
    // 而一個看起來合理的錯誤日期會讓人以為還有三個月，然後濾心爆掉
    const r = computeDue(base)
    expect(r.basis).toBe('NONE')
    expect(r.since).toBeNull()
    expect(r.dueOn).toBeNull()
    expect(r.daysLeft).toBeNull()
    expect(r.overdue).toBe(false)
  })

  it('新購不算起算日 —— 買回來放著不裝，濾心不會開始衰退', () => {
    // computeDue 只收 lastReplacedOn，PURCHASE 事件根本沒有機會進來。
    // 這個測試釘住的是介面本身：呼叫端不可能不小心把新購日傳進去
    const keys = Object.keys(base)
    expect(keys).toContain('lastReplacedOn')
    expect(keys.some((k) => k.toLowerCase().includes('purchase'))).toBe(false)
  })
})

describe('沒設週期', () => {
  it('有起算日但沒設週期：basis 有值，dueOn 是 null', () => {
    // 「知道上次什麼時候換的、但沒設週期」與「連上次什麼時候換的都不知道」
    // 是兩種不同狀態，UI 要能分開講
    const r = computeDue({ ...base, cyclePeriod: null, lastReplacedOn: '2026-08-01' })
    expect(r.basis).toBe('REPLACE')
    expect(r.since).toBe('2026-08-01')
    expect(r.dueOn).toBeNull()
  })
})

describe('日期運算', () => {
  it('以天為單位', () => {
    const r = computeDue({
      ...base, cyclePeriod: 90, cycleUnit: 'DAY', lastReplacedOn: '2026-08-01',
    })
    expect(r.dueOn).toBe('2026-10-30')
  })

  it('月底夾擠：1/31 加 1 個月是 2/28', () => {
    const r = computeDue({
      ...base, cyclePeriod: 1, cycleUnit: 'MONTH', lastReplacedOn: '2026-01-31',
    })
    expect(r.dueOn).toBe('2026-02-28')
  })

  it('跨年', () => {
    const r = computeDue({
      ...base, cyclePeriod: 6, cycleUnit: 'MONTH', lastReplacedOn: '2026-10-15',
    })
    expect(r.dueOn).toBe('2027-04-15')
  })

  it('daysLeft 為 0 代表今天到期，不是已逾期', () => {
    const r = computeDue({
      ...base, cyclePeriod: 1, cycleUnit: 'MONTH', lastReplacedOn: '2026-08-07',
    })
    expect(r.dueOn).toBe('2026-09-07')
    expect(r.daysLeft).toBe(0)
    expect(r.overdue).toBe(false)
  })

  it('逾期的天數是負的', () => {
    const r = computeDue({
      ...base, cyclePeriod: 1, cycleUnit: 'MONTH', lastReplacedOn: '2026-07-01',
    })
    expect(r.dueOn).toBe('2026-08-01')
    expect(r.daysLeft).toBe(-37)
    expect(r.overdue).toBe(true)
  })
})

describe('dueStatus', () => {
  const replaced = computeDue({ ...base, cyclePeriod: 3, lastReplacedOn: '2026-08-01' })
  const overdue = computeDue({ ...base, cyclePeriod: 1, lastReplacedOn: '2026-06-01' })
  const soon = computeDue({ ...base, cyclePeriod: 1, lastReplacedOn: '2026-08-15' })
  const none = computeDue(base)

  it('逾期優先於一切', () => {
    expect(dueStatus(overdue, 0)).toBe('OVERDUE')
    expect(dueStatus(overdue, 5)).toBe('OVERDUE')
  })

  it('14 天內算即將到期', () => {
    expect(soon.daysLeft).toBe(8)
    expect(dueStatus(soon, 0)).toBe('SOON')
  })

  it('沒有起算日但有庫存＝已購入尚未更換', () => {
    // 這時候該提醒的是「去裝」而不是「去買」，混在一起提醒就失去作用
    expect(dueStatus(none, 2)).toBe('PURCHASED')
    expect(dueStatus(none, 0)).toBe('UNSET')
  })

  it('起算日來自裝機日而非更換、且有庫存時也算已購入', () => {
    const byInstall = computeDue({ ...base, cyclePeriod: 3, deviceInstalledOn: '2026-09-01' })
    expect(byInstall.basis).toBe('DEVICE_INSTALL')
    expect(dueStatus(byInstall, 1)).toBe('PURCHASED')
    // 沒庫存就只是還沒到期
    expect(dueStatus(byInstall, 0)).toBe('OK')
  })

  it('換過之後有庫存不算已購入 —— 那是備品，不是待裝', () => {
    expect(dueStatus(replaced, 3)).toBe('OK')
  })
})

describe('dueStatusLabel', () => {
  it('文案', () => {
    const overdue = computeDue({ ...base, cyclePeriod: 1, lastReplacedOn: '2026-07-01' })
    expect(dueStatusLabel('OVERDUE', overdue)).toBe('已逾期 37 天')

    const today = computeDue({ ...base, cyclePeriod: 1, lastReplacedOn: '2026-08-07' })
    expect(dueStatusLabel('SOON', today)).toBe('今天到期')

    expect(dueStatusLabel('UNSET', computeDue(base))).toBe('尚未設定起算日')
    expect(
      dueStatusLabel('UNSET', computeDue({ ...base, cyclePeriod: null, lastReplacedOn: '2026-01-01' })),
    ).toBe('未設週期')
  })
})
