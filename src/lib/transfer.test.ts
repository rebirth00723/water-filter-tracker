import { existsSync, rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const TEST_DB = './data/transfer-test.sqlite3'
process.env.DATABASE_PATH = TEST_DB

const cleanup = () => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(f)) rmSync(f)
  }
}

let db: typeof import('./db').db
let s: typeof import('./db/schema')
let transfer: typeof import('./transfer')
let eventsStore: typeof import('./events-store')

beforeAll(async () => {
  cleanup()
  db = (await import('./db')).db
  s = await import('./db/schema')
  ;(await import('./db/migrate')).runMigrations()
  transfer = await import('./transfer')
  eventsStore = await import('./events-store')
})

afterAll(cleanup)

/** 建一份有代表性的資料：兩台設備、兩個種類、含 PPM 的更換、含單價的新購 */
function seed() {
  const d1 = db
    .insert(s.devices)
    .values({ name: '廚下 RO', model: 'X-1', installedOn: '2025-06-01', sort: 0 })
    .returning()
    .get().id
  const d2 = db.insert(s.devices).values({ name: '客廳', sort: 1, active: false }).returning().get().id

  const c1 = db
    .insert(s.categories)
    .values({ deviceId: d1, name: '第一道', color: '#14b8a6', sort: 0, cyclePeriod: 3, baselineOn: '2026-01-01' })
    .returning()
    .get().id
  const c2 = db
    .insert(s.categories)
    .values({ deviceId: d1, name: 'RO', color: '#dc2626', sort: 1, cyclePeriod: 24, notifyEnabled: false })
    .returning()
    .get().id
  const c3 = db
    .insert(s.categories)
    .values({ deviceId: d2, name: '第一道', color: '#14b8a6', sort: 0 })
    .returning()
    .get().id

  const i1 = db.insert(s.items).values({ categoryId: c1, name: 'PP 棉', brand: '愛惠浦', defaultQty: 2 }).returning().get().id
  const i2 = db.insert(s.items).values({ categoryId: c2, name: 'RO 膜' }).returning().get().id
  db.insert(s.items).values({ categoryId: c3, name: 'PP 棉' }).run()

  eventsStore.createEventTx(d1, {
    type: 'REPLACE', occurredOn: '2026-08-14', vendor: null, note: '例行',
    lines: [
      { itemId: i1, categoryId: c1, qty: 2, unitPrice: null },
      { itemId: i2, categoryId: c2, qty: 1, unitPrice: null },
    ],
    rawPpm: 186, purePpm: 11,
  })
  eventsStore.createEventTx(d1, {
    type: 'PURCHASE', occurredOn: '2026-07-01', vendor: '露天', note: null,
    lines: [{ itemId: i1, categoryId: c1, qty: 4, unitPrice: 250 }],
    rawPpm: null, purePpm: null,
  })
  db.insert(s.readings)
    .values({ deviceId: d1, measuredOn: '2026-09-01', rawPpm: 190, purePpm: 13, note: '例行量測' })
    .run()
  db.insert(s.notifyRules)
    .values({ kind: 'ADVANCE', offsetDays: 14, template: '{category} 還有 {days} 天', priority: 3 })
    .run()
  db.insert(s.settings).values({ key: 'notify.sendTime', value: '09:00' }).run()
  return { d1, d2, c1, c2, i1, i2 }
}

function wipe() {
  db.delete(s.eventItems).run()
  db.delete(s.readings).run()
  db.delete(s.events).run()
  db.delete(s.items).run()
  db.delete(s.categories).run()
  db.delete(s.devices).run()
  db.delete(s.notifyRules).run()
  db.delete(s.settings).run()
  db.delete(s.auditLog).run()
}

beforeEach(wipe)

describe('匯出範圍', () => {
  it('不含認證、稽核與機器組態', () => {
    seed()
    db.insert(s.authState).values({ username: 'rose', passwordHash: 'scrypt$...' }).run()
    db.insert(s.credentials)
      .values({ username: 'rose', credentialId: 'abc', publicKey: 'def' })
      .run()
    db.insert(s.machineConfig).values({ key: 'ntfy.token', value: 'tk_secret' }).run()
    db.insert(s.auditLog).values({ action: 'login.ok', summary: '登入成功' }).run()

    const out = transfer.exportAll()
    const keys = Object.keys(out)
    for (const forbidden of ['credentials', 'authState', 'auditLog', 'notifyLog', 'machineConfig']) {
      expect(keys).not.toContain(forbidden)
    }
    // 更直接的檢查：整份 JSON 裡不該出現任何機密字串
    const json = JSON.stringify(out)
    expect(json).not.toContain('tk_secret')
    expect(json).not.toContain('scrypt$')

    db.delete(s.credentials).run()
    db.delete(s.authState).run()
    db.delete(s.machineConfig).run()
  })
})

describe('取代式匯入（遷移）', () => {
  it('往返一趟之後資料完全等價', () => {
    seed()
    const before = transfer.exportAll()
    wipe()
    expect(db.select().from(s.devices).all()).toHaveLength(0)

    const result = transfer.importAll(before, 'replace')
    expect(result.devices).toBe(2)
    expect(result.events).toBe(2)

    const after = transfer.exportAll()
    // id 會重新配發，所以比對時把 id 抽掉，只比內容與關聯的形狀
    const strip = (p: typeof before) => ({
      devices: p.devices.map(({ id: _i, ...r }) => r),
      categories: p.categories.map(({ id: _i, deviceId: _d, ...r }) => r),
      items: p.items.map(({ id: _i, categoryId: _c, ...r }) => r),
      events: p.events.map(({ id: _i, deviceId: _d, ...r }) => r),
      eventItems: p.eventItems.map(({ eventId: _e, itemId: _it, categoryId: _c, ...r }) => r),
      readings: p.readings.map(({ id: _i, deviceId: _d, eventId: _e, ...r }) => r),
      notifyRules: p.notifyRules,
      settings: p.settings,
    })
    expect(strip(after)).toEqual(strip(before))
  })

  it('關聯在重新配發 id 之後仍然正確', () => {
    seed()
    const payload = transfer.exportAll()
    wipe()
    transfer.importAll(payload, 'replace')

    // 那筆含 PPM 的更換，它的 reading 必須還掛在同一個事件上、日期也一致
    const ev = db
      .select().from(s.events).where(eq(s.events.occurredOn, '2026-08-14')).get()!
    const rd = db.select().from(s.readings).where(eq(s.readings.eventId, ev.id)).get()!
    expect(rd.measuredOn).toBe('2026-08-14')
    expect(rd.rawPpm).toBe(186)
    expect(rd.source).toBe('REPLACE')

    // 明細的種類快照要指向正確的種類
    const lines = db.select().from(s.eventItems).where(eq(s.eventItems.eventId, ev.id)).all()
    expect(lines).toHaveLength(2)
    for (const l of lines) {
      const item = db.select().from(s.items).where(eq(s.items.id, l.itemId)).get()!
      expect(l.categoryId).toBe(item.categoryId)
    }
  })

  it('到期日在匯入後算出同樣的結果', () => {
    seed()
    const payload = transfer.exportAll()
    const beforeDues = eventsStore
      .categoryDues(payload.devices[0].id, '2026-09-07')
      .map((d) => ({ name: d.name, dueOn: d.due.dueOn, basis: d.due.basis, stock: d.stock }))
    wipe()
    transfer.importAll(payload, 'replace')
    const newDeviceId = db.select().from(s.devices).all().sort((a, b) => a.sort - b.sort)[0].id
    const afterDues = eventsStore
      .categoryDues(newDeviceId, '2026-09-07')
      .map((d) => ({ name: d.name, dueOn: d.due.dueOn, basis: d.due.basis, stock: d.stock }))
    expect(afterDues).toEqual(beforeDues)
  })
})

describe('合併式匯入', () => {
  it('把檔案裡的設備當成新設備加進來，現有的不動', () => {
    seed()
    const payload = transfer.exportAll()
    const before = db.select().from(s.devices).all().length

    transfer.importAll(payload, 'merge')
    expect(db.select().from(s.devices).all()).toHaveLength(before * 2)
  })

  it('不帶入通知規則與偏好設定 —— 重複會讓每則提醒送兩次', () => {
    seed()
    const payload = transfer.exportAll()
    const rulesBefore = db.select().from(s.notifyRules).all().length
    const settingsBefore = db.select().from(s.settings).all().length

    const result = transfer.importAll(payload, 'merge')
    expect(db.select().from(s.notifyRules).all()).toHaveLength(rulesBefore)
    expect(db.select().from(s.settings).all()).toHaveLength(settingsBefore)
    expect(result.skipped.join()).toContain('通知規則')
  })

  it('同名種類不會撞唯一索引，因為它們掛在不同的新設備底下', () => {
    seed()
    const payload = transfer.exportAll()
    // cat_device_name_uq 是 (device_id, name)，所以只要設備是新的就不會撞
    expect(() => transfer.importAll(payload, 'merge')).not.toThrow()
  })
})

describe('壞檔案', () => {
  it('格式不對就整筆拒絕', () => {
    expect(transfer.importPayload.safeParse({ hello: 'world' }).success).toBe(false)
    expect(
      transfer.importPayload.safeParse({ format: 'something-else', version: 1 }).success,
    ).toBe(false)
  })

  it('版本號不符就拒絕，不嘗試猜', () => {
    const payload = { ...transfer.exportAll(), version: 999 }
    expect(transfer.importPayload.safeParse(payload).success).toBe(false)
  })

  it('日期格式不對就拒絕', () => {
    seed()
    const payload = transfer.exportAll()
    payload.events[0].occurredOn = '2026/08/14'
    expect(transfer.importPayload.safeParse(payload).success).toBe(false)
  })

  it('關聯指向不存在的父物件時略過該筆而不是整筆失敗', () => {
    seed()
    const payload = transfer.exportAll()
    // 把某個種類的 deviceId 改成不存在的值
    payload.categories[0].deviceId = 99999
    wipe()
    const result = transfer.importAll(payload, 'replace')
    expect(result.skipped.some((x) => x.includes('找不到它的設備'))).toBe(true)
    // 其他資料仍然匯進來了
    expect(result.devices).toBe(2)
  })
})

describe('審查發現的回歸測試', () => {
  it('notify_rules.sendTime 要跟著匯出與匯入', () => {
    /*
     * 這個欄位是在階段 7 加的，而 transfer.ts 寫於階段 6 —— 典型的漂移。
     * 漏掉的後果是換一台機器之後，每條規則的自訂發送時刻都靜默退回全域預設，
     * 而「當天到期要在出門前收到」這種設定就這樣消失了，使用者不會發現。
     */
    wipe()
    db.insert(s.notifyRules)
      .values({
        kind: 'ADVANCE',
        offsetDays: 0,
        template: '{category} 今天到期',
        priority: 4,
        sendTime: '07:30',
      })
      .run()

    const payload = transfer.exportAll()
    expect(payload.notifyRules[0].sendTime).toBe('07:30')

    wipe()
    transfer.importAll(payload, 'replace')
    expect(db.select().from(s.notifyRules).all()[0].sendTime).toBe('07:30')
  })

  it('匯出不含設備專屬的 ntfy topic', () => {
    // UI 明寫「不含 ntfy 的連線與認證」，而 topic 在開放式伺服器上等同密碼
    wipe()
    db.insert(s.devices).values({ name: '機器', ntfyTopic: 'secret-topic-abc123' }).run()
    const json = JSON.stringify(transfer.exportAll())
    expect(json).not.toContain('secret-topic-abc123')
  })

  it('重複的來源 id 整筆拒絕，而不是靜默把歷史接到別台設備上', () => {
    wipe()
    const payload = transfer.exportAll()
    payload.devices = [
      { id: 1, name: 'A', model: null, installedOn: null, ntfyTopic: null, sort: 0, active: true },
      { id: 1, name: 'B', model: null, installedOn: null, ntfyTopic: null, sort: 1, active: true },
    ]
    expect(() => transfer.importAll(payload, 'replace')).toThrow(/重複的設備 id/)
  })

  it('匯入的通知規則要通過與表單同一條交叉檢查', () => {
    // 少了它，匯入可以造出一條沒有天數的 ADVANCE —— 它永遠不知道什麼時候該送
    const base = transfer.exportAll()
    const bad = {
      ...base,
      notifyRules: [
        { kind: 'ADVANCE' as const, offsetDays: null, repeatDays: null,
          template: 'x', priority: 3, sendTime: null, enabled: true },
      ],
    }
    expect(transfer.importPayload.safeParse(bad).success).toBe(false)
  })
})
