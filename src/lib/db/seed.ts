import { eq } from 'drizzle-orm'
import { db } from './index'
import { categories, devices, notifyRules, settings } from './schema'

/** 七個種類。刻意不預載任何耗材品項，由使用者自行新增 */
const STAGES = [
  { key: 's1', name: '第一道', color: '#14B8A6', cycle: 3 },
  { key: 's2', name: '第二道', color: '#8B5CF6', cycle: 6 },
  { key: 's3', name: '第三道', color: '#A855F7', cycle: 6 },
  { key: 's2s3', name: '第二三道', color: '#9333EA', cycle: 6, covers: 's2,s3' },
  { key: 'ro', name: 'RO', color: '#DC2626', cycle: 24 },
  { key: 's5', name: '第五道', color: '#059669', cycle: 12 },
  { key: 's6', name: '第六道', color: '#65A30D', cycle: 12 },
] as const

const DEFAULT_RULES = [
  { kind: 'ADVANCE' as const, offsetDays: 14, priority: 3, template: '{device} 的{category}再 {days} 天就該換了（預計 {dueOn}）' },
  { kind: 'ADVANCE' as const, offsetDays: 3, priority: 4, template: '{device} 的{category}剩 {days} 天（預計 {dueOn}），記得準備耗材' },
  { kind: 'ADVANCE' as const, offsetDays: 0, priority: 4, template: '{device} 的{category}今天到期，該換了' },
  { kind: 'OVERDUE' as const, repeatDays: 7, priority: 5, template: '{device} 的{category}已逾期 {days} 天（原訂 {dueOn}）' },
]

const DEFAULT_SETTINGS: Record<string, string> = {
  'notify.sendTime': '09:00',
  'audit.keepDays': '180',
}

/**
 * 只在**全新的資料庫**上種一次。
 *
 * 判斷依據是一個 settings 旗標，而不是「表格是不是空的」——
 * 後者會在使用者刻意刪光通知規則（或刪光設備）之後，
 * **每次重啟都把它們種回來**。那不是冪等，是跟使用者搶方向盤：
 * 他刪了三次、重啟三次，東西回來三次，而且沒有任何訊息說明為什麼。
 */
const SEEDED_FLAG = 'db.seeded'

export function seedIfEmpty() {
  const already = db.select().from(settings).where(eq(settings.key, SEEDED_FLAG)).get()
  if (already) return

  const existing = db.select({ id: devices.id }).from(devices).limit(1).all()

  if (existing.length === 0) {
    const [device] = db
      .insert(devices)
      .values({ name: '淨水器', sort: 0 })
      .returning({ id: devices.id })
      .all()

    db.insert(categories)
      .values(
        STAGES.map((s, i) => ({
          deviceId: device.id,
          name: s.name,
          color: s.color,
          sort: i,
          cyclePeriod: s.cycle,
          cycleUnit: 'MONTH' as const,
          stageKey: s.key,
          coversStages: 'covers' in s ? s.covers : '',
        })),
      )
      .run()
  }

  if (db.select({ id: notifyRules.id }).from(notifyRules).limit(1).all().length === 0) {
    db.insert(notifyRules).values(DEFAULT_RULES).run()
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const hit = db.select().from(settings).where(eq(settings.key, key)).limit(1).all()
    if (hit.length === 0) db.insert(settings).values({ key, value }).run()
  }

  // 種完才立旗標：中途失敗的話下次啟動會重來，而不是留下半套
  db.insert(settings).values({ key: SEEDED_FLAG, value: new Date().toISOString() }).run()
}
