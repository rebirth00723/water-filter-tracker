import 'server-only'
import { and, asc, count, eq, max } from 'drizzle-orm'
import { db } from './db'
import { categories, devices, eventItems, events, items, readings } from './db/schema'

/**
 * 設定頁的資料存取。從 action 抽出來的理由是**用量檢查要被重複使用** ——
 * 刪除前要問「這筆有沒有歷史」，而 UI 也要在按鈕旁顯示同一個數字，
 * 兩處算法不一致的話會出現「畫面說可以刪、按了說不行」。
 */

export type Category = typeof categories.$inferSelect
export type Item = typeof items.$inferSelect

export function listCategories(deviceId: number): Category[] {
  return db
    .select()
    .from(categories)
    .where(eq(categories.deviceId, deviceId))
    .orderBy(asc(categories.sort), asc(categories.id))
    .all()
}

export function getCategory(id: number): Category | undefined {
  return db.select().from(categories).where(eq(categories.id, id)).get()
}

export function listItems(deviceId: number): Item[] {
  return db
    .select({
      id: items.id,
      categoryId: items.categoryId,
      name: items.name,
      brand: items.brand,
      defaultQty: items.defaultQty,
      active: items.active,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(eq(categories.deviceId, deviceId))
    .orderBy(asc(categories.sort), asc(items.name))
    .all()
}

export function getItem(id: number): Item | undefined {
  return db.select().from(items).where(eq(items.id, id)).get()
}

function scalar(rows: { n: number }[]): number {
  return rows[0]?.n ?? 0
}

/**
 * 該耗材在歷史紀錄裡出現幾次。
 *
 * `event_items.item_id` 是 `restrict`，所以有歷史時 SQLite 會直接拒絕刪除 ——
 * 但它丟出的是 `FOREIGN KEY constraint failed`，那不該出現在使用者眼前。
 * 先問清楚再決定要不要刪，錯誤訊息才能講人話。
 */
export function itemUsage(itemId: number): number {
  return scalar(
    db.select({ n: count() }).from(eventItems).where(eq(eventItems.itemId, itemId)).all(),
  )
}

/** 該種類在歷史紀錄裡出現幾次（`event_items.category_id` 同樣是 restrict） */
export function categoryUsage(categoryId: number): number {
  return scalar(
    db.select({ n: count() }).from(eventItems).where(eq(eventItems.categoryId, categoryId)).all(),
  )
}

/** 該種類底下的耗材數量。刪種類會連帶 cascade 掉這些耗材，所以要先讓使用者知道 */
export function categoryItemCount(categoryId: number): number {
  return scalar(db.select({ n: count() }).from(items).where(eq(items.categoryId, categoryId)).all())
}

/**
 * 該設備底下的歷史筆數。
 *
 * 刪設備會 cascade 掉種類、耗材、事件、明細與水質紀錄 —— 也就是那台機器的全部歷史。
 * 這比刪一筆耗材嚴重一個量級，所以有任何歷史就不給硬刪，只能停用。
 */
export function deviceHistoryCount(deviceId: number): { events: number; readings: number } {
  return {
    events: scalar(db.select({ n: count() }).from(events).where(eq(events.deviceId, deviceId)).all()),
    readings: scalar(
      db.select({ n: count() }).from(readings).where(eq(readings.deviceId, deviceId)).all(),
    ),
  }
}

/** 新增時的排序值：接在最後面。`max()` 回 null 代表目前是空的 */
export function nextDeviceSort(): number {
  return (db.select({ m: max(devices.sort) }).from(devices).get()?.m ?? -1) + 1
}

export function nextCategorySort(deviceId: number): number {
  const row = db
    .select({ m: max(categories.sort) })
    .from(categories)
    .where(eq(categories.deviceId, deviceId))
    .get()
  return (row?.m ?? -1) + 1
}

/** 同一台設備下的種類名稱是否已存在（唯一索引 cat_device_name_uq 的先行檢查） */
export function categoryNameTaken(deviceId: number, name: string, exceptId?: number): boolean {
  const rows = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.deviceId, deviceId), eq(categories.name, name)))
    .all()
  return rows.some((r) => r.id !== exceptId)
}

/** 同一個種類下的耗材名稱是否已存在（唯一索引 item_category_name_uq 的先行檢查） */
export function itemNameTaken(categoryId: number, name: string, exceptId?: number): boolean {
  const rows = db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.categoryId, categoryId), eq(items.name, name)))
    .all()
  return rows.some((r) => r.id !== exceptId)
}

/**
 * 一次撈出整台設備的用量，而不是每筆各問一次。
 *
 * 這裡的 N 只有幾筆、資料庫又在本機，效能不是理由 ——
 * 理由是**畫面與 action 必須看到同一組數字**：
 * 確認對話框上寫「已用於 3 筆紀錄」，按下去卻因為別的數字被拒絕，
 * 那是最難查的一種不一致。集中算一次就沒有兩套算法。
 */
export function usageByCategory(deviceId: number): Map<number, number> {
  const rows = db
    .select({ id: eventItems.categoryId, n: count() })
    .from(eventItems)
    .innerJoin(categories, eq(eventItems.categoryId, categories.id))
    .where(eq(categories.deviceId, deviceId))
    .groupBy(eventItems.categoryId)
    .all()
  return new Map(rows.map((r) => [r.id, r.n]))
}

export function usageByItem(deviceId: number): Map<number, number> {
  const rows = db
    .select({ id: eventItems.itemId, n: count() })
    .from(eventItems)
    .innerJoin(items, eq(eventItems.itemId, items.id))
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(eq(categories.deviceId, deviceId))
    .groupBy(eventItems.itemId)
    .all()
  return new Map(rows.map((r) => [r.id, r.n]))
}
