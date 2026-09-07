import { existsSync, rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = './data/smoke-test.sqlite3'
process.env.DATABASE_PATH = TEST_DB

let db: typeof import('./index').db
let s: typeof import('./schema')

beforeAll(async () => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(f)) rmSync(f)
  }
  db = (await import('./index')).db
  s = await import('./schema')
  const { runMigrations } = await import('./migrate')
  runMigrations()
  const { seedIfEmpty } = await import('./seed')
  seedIfEmpty()
})

afterAll(() => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(f)) rmSync(f)
  }
})

describe('schema 保護機制', () => {
  it('種子建立 1 台設備與 7 個種類，且不預載耗材', () => {
    expect(db.select().from(s.devices).all()).toHaveLength(1)
    const cats = db.select().from(s.categories).all()
    expect(cats).toHaveLength(7)
    expect(cats.map((c) => c.name)).toEqual([
      '第一道', '第二道', '第三道', '第二三道', 'RO', '第五道', '第六道',
    ])
    expect(db.select().from(s.items).all()).toHaveLength(0)
  })

  it('seed 是冪等的', async () => {
    const { seedIfEmpty } = await import('./seed')
    seedIfEmpty()
    seedIfEmpty()
    expect(db.select().from(s.devices).all()).toHaveLength(1)
    expect(db.select().from(s.categories).all()).toHaveLength(7)
    expect(db.select().from(s.notifyRules).all()).toHaveLength(4)
  })

  it('外鍵 restrict：有歷史的耗材不可硬刪', () => {
    const cat = db.select().from(s.categories).all()[0]
    const [item] = db.insert(s.items)
      .values({ categoryId: cat.id, name: 'PP 棉 5 微米' })
      .returning().all()
    const [ev] = db.insert(s.events)
      .values({ deviceId: cat.deviceId, type: 'REPLACE', occurredOn: '2026-09-01' })
      .returning().all()
    db.insert(s.eventItems)
      .values({ eventId: ev.id, itemId: item.id, categoryId: cat.id, qty: 1 })
      .run()

    expect(() => db.delete(s.items).where(eq(s.items.id, item.id)).run()).toThrow()
  })

  it('外鍵 cascade：刪除更換事件時，它擁有的水質紀錄一併消失', () => {
    const cat = db.select().from(s.categories).all()[0]
    const [ev] = db.insert(s.events)
      .values({ deviceId: cat.deviceId, type: 'REPLACE', occurredOn: '2026-09-02' })
      .returning().all()
    db.insert(s.readings).values({
      deviceId: cat.deviceId, measuredOn: '2026-09-02',
      rawPpm: 218, purePpm: 9, source: 'REPLACE', eventId: ev.id,
    }).run()

    expect(db.select().from(s.readings).where(eq(s.readings.eventId, ev.id)).all()).toHaveLength(1)
    db.delete(s.events).where(eq(s.events.id, ev.id)).run()
    expect(db.select().from(s.readings).where(eq(s.readings.eventId, ev.id)).all()).toHaveLength(0)
  })

  it('同一天可以有多筆手動水質紀錄（event_id 為 NULL 不受唯一索引限制）', () => {
    const d = db.select().from(s.devices).all()[0]
    db.insert(s.readings).values([
      { deviceId: d.id, measuredOn: '2026-09-03', rawPpm: 220, purePpm: 10 },
      { deviceId: d.id, measuredOn: '2026-09-03', rawPpm: 219, purePpm: 8 },
    ]).run()
    const same = db.select().from(s.readings)
      .where(eq(s.readings.measuredOn, '2026-09-03')).all()
    expect(same).toHaveLength(2)
  })

  it('notify_log 的冪等鍵擋掉重複送出', () => {
    const cat = db.select().from(s.categories).all()[0]
    const rule = db.select().from(s.notifyRules).all()[0]
    const row = {
      ruleId: rule.id, categoryId: cat.id, target: 'topic-x',
      dueOn: '2026-12-01', kind: 'advance', status: 'sent' as const,
    }
    db.insert(s.notifyLog).values(row).run()
    expect(() => db.insert(s.notifyLog).values(row).run()).toThrow()

    // onConflictDoNothing 才是 sweep 要用的形式：不丟錯，回傳空陣列代表已送過
    const again = db.insert(s.notifyLog).values(row).onConflictDoNothing().returning().all()
    expect(again).toHaveLength(0)
  })
})
