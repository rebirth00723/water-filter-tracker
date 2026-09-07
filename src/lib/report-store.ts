import 'server-only'
import { and, asc, eq, gte } from 'drizzle-orm'
import { addMonths, diffDays, toTs, todayTpe } from './date'
import { db } from './db'
import { categories, eventItems, events, items, readings } from './db/schema'
import { categoryDues, costByCategory, costByYear } from './events-store'

/**
 * 報表資料。
 *
 * 全部在伺服端算好、以**可直接序列化的形狀**傳給圖表元件 ——
 * 日期已經轉成 epoch ms（ECharts 的 X 值），字串日期在這一層就消失了。
 * 客戶端不做任何日期運算，就不會有「瀏覽器時區與 App 時區不同」的差一天。
 */

export type RangeKey = '3m' | '1y' | 'all'

export interface ReportLanePoint {
  ts: number
  /** tooltip 用：「PP 棉×1 活性碳×1」 */
  label: string
}

export interface ReportLane {
  categoryId: number
  name: string
  color: string
  points: ReportLanePoint[]
  /** 下次更換日（epoch ms）。null＝算不出來 */
  dueTs: number | null
  dueOn: string | null
  overdue: boolean
}

export interface ReportData {
  /** [ts, rawPpm, purePpm] */
  readings: [number, number, number][]
  lanes: ReportLane[]
  range: { fromTs: number; toTs: number }
  cost: {
    byCategory: { name: string; color: string; total: number; monthlyAvg: number | null }[]
    byYear: { year: string; total: number }[]
    grandTotal: number
  }
  /** 這台設備總共有幾筆量測，用於判斷「資料還太少」 */
  totalReadings: number
}

function rangeStart(range: RangeKey, today: string): string | null {
  if (range === 'all') return null
  return addMonths(today, range === '3m' ? -3 : -12)
}

export function buildReport(deviceId: number, range: RangeKey): ReportData {
  const today = todayTpe()
  const from = rangeStart(range, today)

  const readingRows = db
    .select({
      measuredOn: readings.measuredOn,
      rawPpm: readings.rawPpm,
      purePpm: readings.purePpm,
    })
    .from(readings)
    .where(
      from
        ? and(eq(readings.deviceId, deviceId), gte(readings.measuredOn, from))
        : eq(readings.deviceId, deviceId),
    )
    .orderBy(asc(readings.measuredOn), asc(readings.id))
    .all()

  /*
   * 只把 active 的種類做成泳道。
   * 停用的第二道／第三道會留下兩條空白列 —— 而那兩條空白列會讓人以為
   * 「這兩道從來沒換過」，實際上是使用者改用了合併的第二三道。
   */
  const dues = categoryDues(deviceId, today).filter((d) => d.active)

  const replaceRows = db
    .select({
      categoryId: eventItems.categoryId,
      occurredOn: events.occurredOn,
      itemName: items.name,
      qty: eventItems.qty,
    })
    .from(eventItems)
    .innerJoin(events, eq(eventItems.eventId, events.id))
    .innerJoin(items, eq(eventItems.itemId, items.id))
    .where(
      from
        ? and(
            eq(events.deviceId, deviceId),
            eq(events.type, 'REPLACE'),
            gte(events.occurredOn, from),
          )
        : and(eq(events.deviceId, deviceId), eq(events.type, 'REPLACE')),
    )
    .orderBy(asc(events.occurredOn))
    .all()

  // 同一天同一種類的多項耗材要合成一個點，否則泳道上會有重疊的圓點
  const grouped = new Map<string, { categoryId: number; ts: number; parts: string[] }>()
  for (const r of replaceRows) {
    const key = `${r.categoryId}|${r.occurredOn}`
    const hit = grouped.get(key)
    const part = r.qty > 1 ? `${r.itemName}×${r.qty}` : r.itemName
    if (hit) hit.parts.push(part)
    else grouped.set(key, { categoryId: r.categoryId, ts: toTs(r.occurredOn), parts: [part] })
  }

  const pointsByCategory = new Map<number, ReportLanePoint[]>()
  for (const g of grouped.values()) {
    const arr = pointsByCategory.get(g.categoryId) ?? []
    arr.push({ ts: g.ts, label: g.parts.join(' ') })
    pointsByCategory.set(g.categoryId, arr)
  }

  const lanes: ReportLane[] = dues.map((d) => ({
    categoryId: d.categoryId,
    name: d.name,
    color: d.color,
    points: (pointsByCategory.get(d.categoryId) ?? []).sort((a, b) => a.ts - b.ts),
    dueTs: d.due.dueOn ? toTs(d.due.dueOn) : null,
    dueOn: d.due.dueOn,
    overdue: d.due.overdue,
  }))

  // 成本
  const catCost = costByCategory(deviceId)
  const catMeta = db
    .select({ id: categories.id, name: categories.name, color: categories.color })
    .from(categories)
    .where(eq(categories.deviceId, deviceId))
    .orderBy(asc(categories.sort))
    .all()

  /** 使用月數：從最早一筆事件到今天。不足一個月算一個月，避免除以 0 */
  const firstEvent = db
    .select({ on: events.occurredOn })
    .from(events)
    .where(eq(events.deviceId, deviceId))
    .orderBy(asc(events.occurredOn))
    .limit(1)
    .get()
  const monthsInUse = firstEvent
    ? Math.max(1, Math.round(diffDays(today, firstEvent.on) / 30.44))
    : null

  const byCategory = catMeta
    .map((c) => {
      const total = catCost.get(c.id) ?? 0
      return {
        name: c.name,
        color: c.color,
        total,
        monthlyAvg: monthsInUse && total > 0 ? total / monthsInUse : null,
      }
    })
    .filter((c) => c.total > 0)

  return {
    readings: readingRows.map((r) => [toTs(r.measuredOn), r.rawPpm, r.purePpm]),
    lanes,
    range: {
      fromTs: toTs(from ?? (readingRows[0]?.measuredOn ?? today)),
      toTs: toTs(today),
    },
    cost: {
      byCategory,
      byYear: costByYear(deviceId),
      grandTotal: byCategory.reduce((s, c) => s + c.total, 0),
    },
    totalReadings: db
      .select({ measuredOn: readings.measuredOn })
      .from(readings)
      .where(eq(readings.deviceId, deviceId))
      .all().length,
  }
}
