import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from './db'
import { events, readings } from './db/schema'

export type Reading = typeof readings.$inferSelect

/**
 * 帶上「這筆是不是某個更換事件擁有的」以及該事件的日期。
 *
 * 為什麼要 join：`source='REPLACE'` 的紀錄不能單獨刪、日期也不能改，
 * 而畫面必須能連到那筆更換紀錄。把判斷做在查詢裡，
 * UI 就不必為了「這筆能不能刪」再回頭問一次資料庫。
 */
export interface ReadingRow extends Reading {
  eventOccurredOn: string | null
}

export function listReadings(deviceId: number, limit = 200): ReadingRow[] {
  return db
    .select({
      id: readings.id,
      deviceId: readings.deviceId,
      measuredOn: readings.measuredOn,
      rawPpm: readings.rawPpm,
      purePpm: readings.purePpm,
      source: readings.source,
      eventId: readings.eventId,
      note: readings.note,
      createdAt: readings.createdAt,
      updatedAt: readings.updatedAt,
      eventOccurredOn: events.occurredOn,
    })
    .from(readings)
    .leftJoin(events, eq(readings.eventId, events.id))
    .where(eq(readings.deviceId, deviceId))
    // 同一天可能有兩筆（例行量測與換後量測），用 id 遞減當第二排序鍵，
    // 較晚建立的排在前面 —— 那通常就是換後的那一筆
    .orderBy(desc(readings.measuredOn), desc(readings.id))
    .limit(limit)
    .all()
}

export function getReading(id: number): Reading | undefined {
  return db.select().from(readings).where(eq(readings.id, id)).get()
}

/** 該設備最近一筆量測。首頁狀態卡與挑選器的「上次」都用它 */
export function latestReading(deviceId: number): Reading | undefined {
  return db
    .select()
    .from(readings)
    .where(eq(readings.deviceId, deviceId))
    .orderBy(desc(readings.measuredOn), desc(readings.id))
    .limit(1)
    .get()
}

export function readingCount(deviceId: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(readings)
    .where(eq(readings.deviceId, deviceId))
    .get()
  return row?.n ?? 0
}

/** 同一天、同一台設備、非事件擁有的紀錄是否已存在（用於提示而非阻止） */
export function manualReadingOnDate(deviceId: number, measuredOn: string): Reading | undefined {
  return db
    .select()
    .from(readings)
    .where(
      and(
        eq(readings.deviceId, deviceId),
        eq(readings.measuredOn, measuredOn),
        eq(readings.source, 'MANUAL'),
      ),
    )
    .get()
}
