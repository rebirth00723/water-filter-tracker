import { existsSync, rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = './data/settings-store-test.sqlite3'
process.env.DATABASE_PATH = TEST_DB

const cleanup = () => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(f)) rmSync(f)
  }
}

let db: typeof import('./db').db
let s: typeof import('./db/schema')
let store: typeof import('./settings-store')

let deviceId: number
let catA: number
let catB: number
let itemA: number
let itemB: number

beforeAll(async () => {
  cleanup()
  db = (await import('./db')).db
  s = await import('./db/schema')
  ;(await import('./db/migrate')).runMigrations()
  store = await import('./settings-store')

  deviceId = db.insert(s.devices).values({ name: '測試機' }).returning().get().id
  catA = db
    .insert(s.categories)
    .values({ deviceId, name: '第一道', color: '#14b8a6', sort: 0 })
    .returning()
    .get().id
  catB = db
    .insert(s.categories)
    .values({ deviceId, name: 'RO', color: '#dc2626', sort: 1 })
    .returning()
    .get().id
  itemA = db.insert(s.items).values({ categoryId: catA, name: 'PP 棉' }).returning().get().id
  itemB = db.insert(s.items).values({ categoryId: catB, name: 'RO 膜' }).returning().get().id
})

afterAll(cleanup)

describe('用量統計', () => {
  it('沒有歷史時全部是 0', () => {
    expect(store.itemUsage(itemA)).toBe(0)
    expect(store.categoryUsage(catA)).toBe(0)
    expect(store.deviceHistoryCount(deviceId)).toEqual({ events: 0, readings: 0 })
  })

  it('建了更換紀錄之後，逐筆查詢與整批查詢給出同一組數字', () => {
    // 這是重點：確認對話框上的數字與 action 的判斷必須同源，
    // 否則會出現「畫面說可以刪、按了說不行」
    const ev = db
      .insert(s.events)
      .values({ deviceId, type: 'REPLACE', occurredOn: '2026-09-01' })
      .returning()
      .get()
    db.insert(s.eventItems).values({ eventId: ev.id, itemId: itemA, categoryId: catA, qty: 1 }).run()

    const ev2 = db
      .insert(s.events)
      .values({ deviceId, type: 'PURCHASE', occurredOn: '2026-09-02' })
      .returning()
      .get()
    db.insert(s.eventItems).values({ eventId: ev2.id, itemId: itemA, categoryId: catA, qty: 2 }).run()

    expect(store.itemUsage(itemA)).toBe(2)
    expect(store.categoryUsage(catA)).toBe(2)
    expect(store.itemUsage(itemB)).toBe(0)

    const byItem = store.usageByItem(deviceId)
    const byCat = store.usageByCategory(deviceId)
    expect(byItem.get(itemA)).toBe(store.itemUsage(itemA))
    expect(byCat.get(catA)).toBe(store.categoryUsage(catA))
    // 沒有紀錄的不會出現在整批查詢裡，消費端要自己當成 0
    expect(byItem.get(itemB)).toBeUndefined()
    expect(byCat.get(catB)).toBeUndefined()
  })

  it('整批查詢只算這台設備的，不會把別台的算進來', () => {
    const other = db.insert(s.devices).values({ name: '另一台' }).returning().get().id
    const otherCat = db
      .insert(s.categories)
      .values({ deviceId: other, name: '第一道', color: '#14b8a6' })
      .returning()
      .get().id
    const otherItem = db
      .insert(s.items)
      .values({ categoryId: otherCat, name: 'PP 棉' })
      .returning()
      .get().id
    const ev = db
      .insert(s.events)
      .values({ deviceId: other, type: 'REPLACE', occurredOn: '2026-09-03' })
      .returning()
      .get()
    db.insert(s.eventItems)
      .values({ eventId: ev.id, itemId: otherItem, categoryId: otherCat, qty: 1 })
      .run()

    expect(store.usageByItem(deviceId).has(otherItem)).toBe(false)
    expect(store.usageByItem(other).get(otherItem)).toBe(1)
  })

  it('設備歷史筆數同時看事件與水質紀錄', () => {
    db.insert(s.readings)
      .values({ deviceId, measuredOn: '2026-09-01', rawPpm: 180, purePpm: 12 })
      .run()
    const h = store.deviceHistoryCount(deviceId)
    expect(h.events).toBe(2)
    expect(h.readings).toBe(1)
  })
})

describe('名稱重複檢查', () => {
  it('同一台設備下的種類名稱不可重複，不同設備可以', () => {
    expect(store.categoryNameTaken(deviceId, '第一道')).toBe(true)
    expect(store.categoryNameTaken(deviceId, '第二道')).toBe(false)
    // 編輯自己時要排除自己，否則改別的欄位會被自己的名字擋住
    expect(store.categoryNameTaken(deviceId, '第一道', catA)).toBe(false)
  })

  it('同一個種類下的耗材名稱不可重複', () => {
    expect(store.itemNameTaken(catA, 'PP 棉')).toBe(true)
    expect(store.itemNameTaken(catB, 'PP 棉')).toBe(false)
    expect(store.itemNameTaken(catA, 'PP 棉', itemA)).toBe(false)
  })
})

describe('排序值', () => {
  it('新增的種類接在最後面', () => {
    expect(store.nextCategorySort(deviceId)).toBe(2)
  })

  it('該設備沒有任何種類時從 0 開始', () => {
    const empty = db.insert(s.devices).values({ name: '空的' }).returning().get().id
    expect(store.nextCategorySort(empty)).toBe(0)
  })
})

describe('清單查詢', () => {
  it('耗材清單依種類順序、再依名稱排列', () => {
    db.insert(s.items).values({ categoryId: catA, name: 'AAA 濾心' }).run()
    const names = store.listItems(deviceId).map((i) => i.name)
    // catA（sort 0）的兩項在前，且其中依名稱排序；catB（sort 1）的在後
    expect(names).toEqual(['AAA 濾心', 'PP 棉', 'RO 膜'])
  })

  it('種類清單只回這台設備的', () => {
    const cats = store.listCategories(deviceId)
    expect(cats.map((c) => c.name)).toEqual(['第一道', 'RO'])
  })
})
