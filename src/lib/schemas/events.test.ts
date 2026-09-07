import { describe, expect, it } from 'vitest'
import { createEvent, eventFormSchema, updateEvent } from './events'

const lines = [{ itemId: 1, categoryId: 1, qty: 1, unitPrice: '' }]

const replace = { type: 'REPLACE' as const, occurredOn: '2026-09-07', note: '', rawPpm: '', purePpm: '', lines }
const purchase = { type: 'PURCHASE' as const, occurredOn: '2026-09-07', note: '', vendor: '', lines }

describe('PPM 只存在於 REPLACE 分支', () => {
  it('REPLACE 可以帶 PPM', () => {
    const out = eventFormSchema.parse({ ...replace, rawPpm: '186', purePpm: '11' })
    expect(out).toMatchObject({ type: 'REPLACE', rawPpm: 186, purePpm: 11 })
  })

  it('PURCHASE 的輸出裡沒有 PPM 欄位 —— 不是隱藏，是根本不存在', () => {
    // 隱藏欄位仍然會被送出、仍然要在伺服端記得忽略；不存在就沒有這個問題
    const out = eventFormSchema.parse(purchase)
    expect(out).not.toHaveProperty('rawPpm')
    expect(out).not.toHaveProperty('purePpm')
  })

  it('PURCHASE 硬塞 PPM 也會被丟掉', () => {
    const out = eventFormSchema.parse({ ...purchase, rawPpm: '999', purePpm: '1' } as never)
    expect(out).not.toHaveProperty('rawPpm')
  })

  it('REPLACE 的輸出裡沒有 vendor —— 換濾心沒有「在哪買」這件事', () => {
    const out = eventFormSchema.parse(replace)
    expect(out).not.toHaveProperty('vendor')
  })
})

describe('PPM 必須成對', () => {
  it('只填原水被擋下', () => {
    const r = eventFormSchema.safeParse({ ...replace, rawPpm: '186' })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].path).toEqual(['purePpm'])
    expect(r.error!.issues[0].message).toContain('一起填')
  })

  it('只填純水被擋下', () => {
    const r = eventFormSchema.safeParse({ ...replace, purePpm: '11' })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].path).toEqual(['rawPpm'])
  })

  it('兩個都不填是合法的 —— 換濾心時忘記帶 TDS 筆很正常', () => {
    const out = eventFormSchema.parse(replace)
    expect(out).toMatchObject({ rawPpm: null, purePpm: null })
  })

  it('純水高於原水被擋下', () => {
    const r = eventFormSchema.safeParse({ ...replace, rawPpm: '11', purePpm: '186' })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].message).toContain('填反')
  })
})

describe('明細', () => {
  it('至少要有一項', () => {
    const r = eventFormSchema.safeParse({ ...replace, lines: [] })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].message).toContain('至少要有一項')
  })

  it('同一筆不可重複同一項耗材', () => {
    // 資料庫有 ei_event_item_uq 唯一索引，撞到會丟 SQLITE_CONSTRAINT，
    // 而那不該出現在使用者眼前。UI 會合併數量，但伺服端不能假設客戶端做對了
    const r = eventFormSchema.safeParse({
      ...replace,
      lines: [
        { itemId: 1, categoryId: 1, qty: 1, unitPrice: '' },
        { itemId: 1, categoryId: 1, qty: 2, unitPrice: '' },
      ],
    })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].path).toEqual(['lines', 1, 'itemId'])
    expect(r.error!.issues[0].message).toContain('調整數量')
  })

  it('不同耗材同一種類是合法的', () => {
    expect(
      eventFormSchema.safeParse({
        ...replace,
        lines: [
          { itemId: 1, categoryId: 1, qty: 1, unitPrice: '' },
          { itemId: 2, categoryId: 1, qty: 1, unitPrice: '' },
        ],
      }).success,
    ).toBe(true)
  })

  it('數量必須是 1–99 的整數', () => {
    for (const qty of [0, -1, 1.5, 100]) {
      expect(
        eventFormSchema.safeParse({ ...replace, lines: [{ ...lines[0], qty }] }).success,
      ).toBe(false)
    }
  })

  it('單價留空變 null，不是 0', () => {
    // 0 代表「免費拿到的」，null 代表「沒記」—— 成本統計必須能分辨
    const out = eventFormSchema.parse(purchase)
    expect(out.lines[0].unitPrice).toBeNull()
    const withPrice = eventFormSchema.parse({
      ...purchase, lines: [{ ...lines[0], unitPrice: '0' }],
    })
    expect(withPrice.lines[0].unitPrice).toBe(0)
  })
})

describe('createEvent / updateEvent', () => {
  it('createEvent 需要 deviceId，兩個分支都要', () => {
    expect(createEvent.safeParse(replace).success).toBe(false)
    expect(createEvent.safeParse({ ...replace, deviceId: 1 }).success).toBe(true)
    expect(createEvent.safeParse({ ...purchase, deviceId: 1 }).success).toBe(true)
  })

  it('updateEvent 需要 id，且跨欄位檢查一樣生效', () => {
    expect(updateEvent.safeParse({ ...replace, id: 1 }).success).toBe(true)
    expect(updateEvent.safeParse({ ...replace, id: 1, rawPpm: '5' }).success).toBe(false)
  })

  it('三個 schema 對同一筆輸入的判斷一致', () => {
    const bad = { ...replace, rawPpm: '11', purePpm: '999' }
    expect(eventFormSchema.safeParse(bad).success).toBe(false)
    expect(createEvent.safeParse({ ...bad, deviceId: 1 }).success).toBe(false)
    expect(updateEvent.safeParse({ ...bad, id: 1 }).success).toBe(false)
  })
})

describe('type 必須是已知的值', () => {
  it('未知的 type 被擋下', () => {
    expect(eventFormSchema.safeParse({ ...replace, type: 'ADJUST' } as never).success).toBe(false)
    expect(eventFormSchema.safeParse({ ...replace, type: 'DROP TABLE' } as never).success).toBe(false)
  })
})
