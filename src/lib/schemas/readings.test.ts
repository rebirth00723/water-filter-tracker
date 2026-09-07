import { describe, expect, it } from 'vitest'
import { createReading, readingFormSchema, updateEventReading } from './readings'

const base = { measuredOn: '2026-09-07', rawPpm: '180', purePpm: '12', note: '' }

describe('readingFormSchema', () => {
  it('字串進、數字出，空備註變 null', () => {
    const out = readingFormSchema.parse(base)
    expect(out).toEqual({ measuredOn: '2026-09-07', rawPpm: 180, purePpm: 12, note: null })
  })

  it('純水 0 是合法的（好的 RO 膜配新後置就會是 0）', () => {
    // 這是 nonNegativeInt 存在的理由：下限設成 1 會讓最理想的讀數填不進去
    expect(readingFormSchema.parse({ ...base, purePpm: '0' }).purePpm).toBe(0)
  })

  it('負數與非整數被擋掉', () => {
    for (const v of ['-1', '1.5', 'abc']) {
      expect(readingFormSchema.safeParse({ ...base, purePpm: v }).success).toBe(false)
    }
  })

  it('超過 9999 被擋掉', () => {
    expect(readingFormSchema.safeParse({ ...base, rawPpm: '10000' }).success).toBe(false)
    expect(readingFormSchema.safeParse({ ...base, rawPpm: '9999' }).success).toBe(true)
  })

  it('兩個都必填，空字串不算', () => {
    expect(readingFormSchema.safeParse({ ...base, rawPpm: '' }).success).toBe(false)
    expect(readingFormSchema.safeParse({ ...base, purePpm: '' }).success).toBe(false)
  })

  it('純水高於原水時擋下並指出可能填反了', () => {
    // 站在水槽邊換杯子量，兩個數字填反的機率不低 ——
    // 填反之後圖上兩條線會交叉，看起來像濾心壞掉，是最容易誤判的髒資料
    const r = readingFormSchema.safeParse({ ...base, rawPpm: '12', purePpm: '180' })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].path).toEqual(['purePpm'])
    expect(r.error!.issues[0].message).toContain('填反')
  })

  it('兩者相等是合法的（新裝機或濾心已完全失效）', () => {
    expect(readingFormSchema.safeParse({ ...base, rawPpm: '50', purePpm: '50' }).success).toBe(true)
  })

  it('日期必填且必須是真實日期', () => {
    expect(readingFormSchema.safeParse({ ...base, measuredOn: '' }).success).toBe(false)
    expect(readingFormSchema.safeParse({ ...base, measuredOn: '2026-02-31' }).success).toBe(false)
    expect(readingFormSchema.safeParse({ ...base, measuredOn: '2026-9-7' }).success).toBe(false)
  })
})

describe('updateEventReading', () => {
  it('沒有 measuredOn 欄位 —— 日期由更換事件擁有，不能從這裡改', () => {
    const out = updateEventReading.parse({ id: 1, rawPpm: '200', purePpm: '15', note: '' })
    expect(out).not.toHaveProperty('measuredOn')
    expect(out).toEqual({ id: 1, rawPpm: 200, purePpm: 15, note: null })
  })

  it('多送 measuredOn 也不會被採用', () => {
    // 分成兩個 schema 而不是用旗標分支：能改的欄位是型別的一部分，
    // 不取決於客戶端送了什麼
    const out = updateEventReading.parse({
      id: 1, rawPpm: '200', purePpm: '15', note: '', measuredOn: '1999-01-01',
    } as never)
    expect(out).not.toHaveProperty('measuredOn')
  })

  it('同一條純水不高於原水的規則也適用', () => {
    expect(updateEventReading.safeParse({ id: 1, rawPpm: '10', purePpm: '99', note: '' }).success)
      .toBe(false)
  })
})

describe('createReading', () => {
  it('需要 deviceId', () => {
    expect(createReading.safeParse(base).success).toBe(false)
    expect(createReading.safeParse({ ...base, deviceId: 1 }).success).toBe(true)
  })
})
