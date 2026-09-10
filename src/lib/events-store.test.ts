import { existsSync, rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const TEST_DB = './data/events-store-test.sqlite3'
process.env.DATABASE_PATH = TEST_DB

const cleanup = () => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(f)) rmSync(f)
  }
}

let db: typeof import('./db').db
let s: typeof import('./db/schema')
let store: typeof import('./events-store')

let deviceId: number
let catPP: number
let catRO: number
let itemPP: number
let itemCarbon: number
let itemRO: number

beforeAll(async () => {
  cleanup()
  db = (await import('./db')).db
  s = await import('./db/schema')
  ;(await import('./db/migrate')).runMigrations()
  store = await import('./events-store')

  deviceId = db
    .insert(s.devices)
    .values({ name: '測試機', installedOn: '2025-06-01' })
    .returning()
    .get().id
  catPP = db
    .insert(s.categories)
    .values({ deviceId, name: '第一道', color: '#14b8a6', sort: 0, cyclePeriod: 3 })
    .returning()
    .get().id
  catRO = db
    .insert(s.categories)
    .values({ deviceId, name: 'RO', color: '#dc2626', sort: 1, cyclePeriod: 24 })
    .returning()
    .get().id
  itemPP = db.insert(s.items).values({ categoryId: catPP, name: 'PP 棉' }).returning().get().id
  itemCarbon = db.insert(s.items).values({ categoryId: catPP, name: '活性碳' }).returning().get().id
  itemRO = db.insert(s.items).values({ categoryId: catRO, name: 'RO 膜' }).returning().get().id
})

afterAll(cleanup)

beforeEach(() => {
  // 每個測試從乾淨的事件開始 —— 庫存與到期都是累加的，殘留會讓斷言互相干擾
  db.delete(s.events).run()
})

const line = (itemId: number, categoryId: number, qty = 1, unitPrice: number | null = null) => ({
  itemId, categoryId, qty, unitPrice,
})

describe('createEventTx', () => {
  it('更換帶 PPM 時同時建立一筆 reading，日期與事件相同', () => {
    const id = store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: null,
      lines: [line(itemPP, catPP)], rawPpm: 186, purePpm: 11,
    })
    const rd = db.select().from(s.readings).where(eq(s.readings.eventId, id)).get()!
    expect(rd.measuredOn).toBe('2026-08-14')
    expect(rd.source).toBe('REPLACE')
    expect(rd.rawPpm).toBe(186)
  })

  it('沒帶 PPM 就不建 reading', () => {
    const id = store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: null,
      lines: [line(itemPP, catPP)], rawPpm: null, purePpm: null,
    })
    expect(db.select().from(s.readings).where(eq(s.readings.eventId, id)).all()).toHaveLength(0)
  })

  it('PURCHASE 不建 reading，即使硬塞 PPM', () => {
    const id = store.createEventTx(deviceId, {
      type: 'PURCHASE', occurredOn: '2026-08-14', vendor: '露天', note: null,
      lines: [line(itemPP, catPP, 2, 250)], rawPpm: 186, purePpm: 11,
    })
    expect(db.select().from(s.readings).where(eq(s.readings.eventId, id)).all()).toHaveLength(0)
  })
})

describe('updateEventTx —— 改事件日期時 reading 的日期必須跟著移動', () => {
  it('這是整個連動裡最容易漏的一行', () => {
    /*
     * 漏掉之後資料庫看起來完全正常：reading 還在、PPM 也對，
     * 只有 measured_on 留在舊日期 —— 而症狀是報表上那個點沒有跟著移動，
     * 使用者要對照日曆才會發現。
     */
    const id = store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: null,
      lines: [line(itemPP, catPP)], rawPpm: 186, purePpm: 11,
    })
    store.updateEventTx(id, {
      type: 'REPLACE', occurredOn: '2026-08-20', vendor: null, note: null,
      lines: [line(itemPP, catPP)], rawPpm: 186, purePpm: 11,
    })
    const rd = db.select().from(s.readings).where(eq(s.readings.eventId, id)).get()!
    expect(rd.measuredOn).toBe('2026-08-20')
  })

  it('PPM 被清空時刪掉那筆 reading', () => {
    const id = store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: null,
      lines: [line(itemPP, catPP)], rawPpm: 186, purePpm: 11,
    })
    store.updateEventTx(id, {
      type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: null,
      lines: [line(itemPP, catPP)], rawPpm: null, purePpm: null,
    })
    expect(db.select().from(s.readings).where(eq(s.readings.eventId, id)).all()).toHaveLength(0)
  })

  it('原本沒 PPM、後來補填 → 建立一筆新的 reading', () => {
    const id = store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: null,
      lines: [line(itemPP, catPP)], rawPpm: null, purePpm: null,
    })
    store.updateEventTx(id, {
      type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: null,
      lines: [line(itemPP, catPP)], rawPpm: 200, purePpm: 15,
    })
    const rd = db.select().from(s.readings).where(eq(s.readings.eventId, id)).get()!
    expect(rd.rawPpm).toBe(200)
    expect(rd.measuredOn).toBe('2026-08-14')
  })

  it('型別從 REPLACE 改成 PURCHASE 時 reading 一併消失', () => {
    const id = store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: null,
      lines: [line(itemPP, catPP)], rawPpm: 186, purePpm: 11,
    })
    store.updateEventTx(id, {
      type: 'PURCHASE', occurredOn: '2026-08-14', vendor: '露天', note: null,
      lines: [line(itemPP, catPP, 1, 250)], rawPpm: 186, purePpm: 11,
    })
    expect(db.select().from(s.readings).where(eq(s.readings.eventId, id)).all()).toHaveLength(0)
  })

  it('明細刪光重建：換掉的項目不會殘留', () => {
    const id = store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: null,
      lines: [line(itemPP, catPP), line(itemCarbon, catPP)], rawPpm: null, purePpm: null,
    })
    store.updateEventTx(id, {
      type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: null,
      lines: [line(itemRO, catRO, 1)], rawPpm: null, purePpm: null,
    })
    const ls = db.select().from(s.eventItems).where(eq(s.eventItems.eventId, id)).all()
    expect(ls).toHaveLength(1)
    expect(ls[0].itemId).toBe(itemRO)
  })
})

describe('deleteEventTx', () => {
  it('cascade 帶走 eventItems 與 reading', () => {
    const id = store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: null,
      lines: [line(itemPP, catPP)], rawPpm: 186, purePpm: 11,
    })
    store.deleteEventTx(id)
    expect(db.select().from(s.eventItems).where(eq(s.eventItems.eventId, id)).all()).toHaveLength(0)
    expect(db.select().from(s.readings).where(eq(s.readings.eventId, id)).all()).toHaveLength(0)
  })
})

describe('庫存', () => {
  it('買進 − 換掉 + 盤點調整', () => {
    store.createEventTx(deviceId, {
      type: 'PURCHASE', occurredOn: '2026-01-01', vendor: null, note: null,
      lines: [line(itemPP, catPP, 4, 250)], rawPpm: null, purePpm: null,
    })
    store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-04-01', vendor: null, note: null,
      lines: [line(itemPP, catPP, 1)], rawPpm: null, purePpm: null,
    })
    expect(store.stockByItem(deviceId).get(itemPP)).toBe(3)
    expect(store.stockByCategory(deviceId).get(catPP)).toBe(3)
  })

  it('允許負數並如實顯示 —— 換到 App 出現前買的濾心就會這樣', () => {
    // 夾到 0 只會把問題藏起來；顯示「庫存 −1」才會讓人想起「那批沒記進來」
    store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-04-01', vendor: null, note: null,
      lines: [line(itemPP, catPP, 1)], rawPpm: null, purePpm: null,
    })
    expect(store.stockByItem(deviceId).get(itemPP)).toBe(-1)
  })

  it('ADJUST 直接加上去（可為負）', () => {
    store.createEventTx(deviceId, {
      type: 'ADJUST', occurredOn: '2026-05-01', vendor: null, note: '盤點',
      lines: [line(itemPP, catPP, 2)], rawPpm: null, purePpm: null,
    })
    expect(store.stockByItem(deviceId).get(itemPP)).toBe(2)
  })
})

describe('到期日的四階梯（走真實資料）', () => {
  it('有更換紀錄時依它推算', () => {
    store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-08-01', vendor: null, note: null,
      lines: [line(itemPP, catPP)], rawPpm: null, purePpm: null,
    })
    const dues = store.categoryDues(deviceId, '2026-09-07')
    const pp = dues.find((d) => d.categoryId === catPP)!
    expect(pp.due.basis).toBe('REPLACE')
    expect(pp.due.dueOn).toBe('2026-11-01')
  })

  it('新購不會被當成起算日', () => {
    // 買回來放著不裝，濾心不會開始衰退
    store.createEventTx(deviceId, {
      type: 'PURCHASE', occurredOn: '2026-08-01', vendor: null, note: null,
      lines: [line(itemPP, catPP, 1, 250)], rawPpm: null, purePpm: null,
    })
    const pp = store.categoryDues(deviceId, '2026-09-07').find((d) => d.categoryId === catPP)!
    // 退到第 3 階（設備裝機日 2025-06-01），而不是用 2026-08-01
    expect(pp.due.basis).toBe('DEVICE_INSTALL')
    expect(pp.due.since).toBe('2025-06-01')
    // 而且因為有庫存又沒換過，狀態是「已購入，尚未更換」…除非已經逾期
    expect(pp.stock).toBe(1)
  })

  it('只算自己設備的更換紀錄', () => {
    const other = db.insert(s.devices).values({ name: '別台' }).returning().get().id
    const otherCat = db
      .insert(s.categories)
      .values({ deviceId: other, name: '第一道', color: '#14b8a6', cyclePeriod: 3 })
      .returning()
      .get().id
    const otherItem = db
      .insert(s.items).values({ categoryId: otherCat, name: 'PP 棉' }).returning().get().id
    store.createEventTx(other, {
      type: 'REPLACE', occurredOn: '2026-09-01', vendor: null, note: null,
      lines: [line(otherItem, otherCat)], rawPpm: null, purePpm: null,
    })
    const pp = store.categoryDues(deviceId, '2026-09-07').find((d) => d.categoryId === catPP)!
    expect(pp.due.basis).not.toBe('REPLACE')
  })
})

describe('成本與範本', () => {
  it('累計金額是單價 × 數量', () => {
    store.createEventTx(deviceId, {
      type: 'PURCHASE', occurredOn: '2026-03-01', vendor: '露天', note: null,
      lines: [line(itemPP, catPP, 2, 250), line(itemRO, catRO, 1, 1800)],
      rawPpm: null, purePpm: null,
    })
    const byCat = store.costByCategory(deviceId)
    expect(byCat.get(catPP)).toBe(500)
    expect(byCat.get(catRO)).toBe(1800)
    expect(store.costByYear(deviceId)).toEqual([{ year: '2026', total: 2300 }])
  })

  it('沒填單價的算 0，不會讓整筆變成 null', () => {
    store.createEventTx(deviceId, {
      type: 'PURCHASE', occurredOn: '2026-03-01', vendor: null, note: null,
      lines: [line(itemPP, catPP, 2, null), line(itemCarbon, catPP, 1, 100)],
      rawPpm: null, purePpm: null,
    })
    expect(store.costByCategory(deviceId).get(catPP)).toBe(100)
  })

  it('上次購買取最近那一次', () => {
    store.createEventTx(deviceId, {
      type: 'PURCHASE', occurredOn: '2026-01-01', vendor: '蝦皮', note: null,
      lines: [line(itemPP, catPP, 1, 200)], rawPpm: null, purePpm: null,
    })
    store.createEventTx(deviceId, {
      type: 'PURCHASE', occurredOn: '2026-06-01', vendor: '露天', note: null,
      lines: [line(itemPP, catPP, 1, 260)], rawPpm: null, purePpm: null,
    })
    expect(store.lastPurchaseByItem(deviceId).get(itemPP)).toMatchObject({
      unitPrice: 260, vendor: '露天', occurredOn: '2026-06-01',
    })
  })

  it('範本依品項組合去重', () => {
    for (const d of ['2026-01-01', '2026-04-01', '2026-07-01']) {
      store.createEventTx(deviceId, {
        type: 'REPLACE', occurredOn: d, vendor: null, note: null,
        lines: [line(itemPP, catPP), line(itemCarbon, catPP)], rawPpm: null, purePpm: null,
      })
    }
    store.createEventTx(deviceId, {
      type: 'REPLACE', occurredOn: '2026-08-01', vendor: null, note: null,
      lines: [line(itemRO, catRO)], rawPpm: null, purePpm: null,
    })
    const t = store.recentTemplates(deviceId)
    // 三筆一樣的組合只算一個範本
    expect(t).toHaveLength(2)
    expect(t[0].lines).toHaveLength(1)   // 最近的是只換 RO 那筆
    expect(t[1].lines).toHaveLength(2)
  })

  it('沒有更換紀錄時沒有範本', () => {
    expect(store.recentTemplates(deviceId)).toEqual([])
  })
})

describe('審查發現的回歸測試', () => {
  it('明細必須屬於這台設備 —— 形狀正確但關係不對的輸入要擋下', () => {
    /*
     * itemId 與 categoryId 各自合法，但組合起來未必屬於同一台設備。
     * 不擋的話可以把 A 機的濾心記到 B 機的更換紀錄上，
     * 兩邊的庫存與到期日都會算錯，而且沒有任何錯誤訊息。
     */
    const other = db.insert(s.devices).values({ name: '別台' }).returning().get().id
    const otherCat = db
      .insert(s.categories)
      .values({ deviceId: other, name: '第一道', color: '#14b8a6' })
      .returning()
      .get().id
    const otherItem = db
      .insert(s.items).values({ categoryId: otherCat, name: '別台的 PP 棉' }).returning().get().id

    // 別台的耗材記到這台
    expect(store.validateLines(deviceId, [{ itemId: otherItem, categoryId: otherCat }]))
      .toMatch(/不屬於這台設備/)
    // 自己的耗材配錯種類
    expect(store.validateLines(deviceId, [{ itemId: itemPP, categoryId: catRO }]))
      .toMatch(/種類對不上/)
    // 正確的組合過關
    expect(store.validateLines(deviceId, [{ itemId: itemPP, categoryId: catPP }])).toBeNull()
    // 空清單不算錯（zod 另外擋「至少一項」）
    expect(store.validateLines(deviceId, [])).toBeNull()
  })
})
