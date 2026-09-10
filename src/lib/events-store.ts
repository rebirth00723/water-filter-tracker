import 'server-only'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from './db'
import { categories, devices, eventItems, events, items, readings } from './db/schema'
import { computeDue, dueStatus, type DueResult, type DueStatus } from './due'
import type { PickerCategory } from './picker-data'

export type Event = typeof events.$inferSelect
export type EventItem = typeof eventItems.$inferSelect

export interface EventItemRow extends EventItem {
  itemName: string
  itemBrand: string | null
  categoryName: string
  categoryColor: string
}

export interface EventRow extends Event {
  lines: EventItemRow[]
  /** 該事件擁有的水質紀錄（只有 REPLACE 會有） */
  reading: { id: number; rawPpm: number; purePpm: number } | null
  /** unitPrice × qty 的總和，只有 PURCHASE 有意義 */
  total: number
}

// ───────────────────────────── 事件查詢 ─────────────────────────────

/**
 * 事件清單。刻意用兩次查詢再在記憶體裡組裝，而不是一次 join ——
 * join 會讓一筆含六項耗材的事件變成六列，然後要在應用層去重，
 * 而去重的過程比多一次查詢更容易寫錯。這裡的資料量是幾百列，不值得為此冒險。
 */
export function listEvents(deviceId: number, limit = 100): EventRow[] {
  const rows = db
    .select()
    .from(events)
    .where(eq(events.deviceId, deviceId))
    .orderBy(desc(events.occurredOn), desc(events.id))
    .limit(limit)
    .all()
  return attachLines(rows)
}

export function getEvent(id: number): EventRow | undefined {
  const row = db.select().from(events).where(eq(events.id, id)).get()
  if (!row) return undefined
  return attachLines([row])[0]
}

function attachLines(rows: Event[]): EventRow[] {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  const lines = db
    .select({
      id: eventItems.id,
      eventId: eventItems.eventId,
      itemId: eventItems.itemId,
      categoryId: eventItems.categoryId,
      qty: eventItems.qty,
      unitPrice: eventItems.unitPrice,
      itemName: items.name,
      itemBrand: items.brand,
      categoryName: categories.name,
      categoryColor: categories.color,
    })
    .from(eventItems)
    .innerJoin(items, eq(eventItems.itemId, items.id))
    .innerJoin(categories, eq(eventItems.categoryId, categories.id))
    .where(inArray(eventItems.eventId, ids))
    .orderBy(asc(categories.sort), asc(items.name))
    .all()

  const eventReadings = db
    .select({
      id: readings.id,
      eventId: readings.eventId,
      rawPpm: readings.rawPpm,
      purePpm: readings.purePpm,
    })
    .from(readings)
    .where(inArray(readings.eventId, ids))
    .all()

  const byEvent = new Map<number, EventItemRow[]>()
  for (const l of lines) {
    const arr = byEvent.get(l.eventId) ?? []
    arr.push(l)
    byEvent.set(l.eventId, arr)
  }
  const readingByEvent = new Map(eventReadings.map((r) => [r.eventId, r]))

  return rows.map((r) => {
    const ls = byEvent.get(r.id) ?? []
    const rd = readingByEvent.get(r.id)
    return {
      ...r,
      lines: ls,
      reading: rd ? { id: rd.id, rawPpm: rd.rawPpm, purePpm: rd.purePpm } : null,
      total: ls.reduce((sum, l) => sum + (l.unitPrice ?? 0) * l.qty, 0),
    }
  })
}

// ───────────────────────────── 庫存 ─────────────────────────────

/**
 * 庫存＝買進 − 換掉 + 盤點調整。即時計算，不做冗餘欄位。
 *
 * **允許負數並如實顯示。** 使用者一定會換到這個 App 出現以前買的濾心，
 * 夾到 0 只會把問題藏起來 —— 顯示「庫存 −1」才會讓人想起「喔，那批沒記進來」。
 * 這也是 ADJUST 事件型別存在的理由。
 */
export function stockByItem(deviceId: number): Map<number, number> {
  const rows = db
    .select({
      itemId: eventItems.itemId,
      stock: sql<number>`sum(case ${events.type}
        when 'PURCHASE' then ${eventItems.qty}
        when 'REPLACE' then -${eventItems.qty}
        else ${eventItems.qty} end)`,
    })
    .from(eventItems)
    .innerJoin(events, eq(eventItems.eventId, events.id))
    .where(eq(events.deviceId, deviceId))
    .groupBy(eventItems.itemId)
    .all()
  return new Map(rows.map((r) => [r.itemId, r.stock]))
}

export function stockByCategory(deviceId: number): Map<number, number> {
  const rows = db
    .select({
      categoryId: eventItems.categoryId,
      stock: sql<number>`sum(case ${events.type}
        when 'PURCHASE' then ${eventItems.qty}
        when 'REPLACE' then -${eventItems.qty}
        else ${eventItems.qty} end)`,
    })
    .from(eventItems)
    .innerJoin(events, eq(eventItems.eventId, events.id))
    .where(eq(events.deviceId, deviceId))
    .groupBy(eventItems.categoryId)
    .all()
  return new Map(rows.map((r) => [r.categoryId, r.stock]))
}

// ───────────────────────────── 到期 ─────────────────────────────

/** 該設備每個種類最後一次 REPLACE 的日期 */
export function lastReplacedByCategory(deviceId: number): Map<number, string> {
  const rows = db
    .select({
      categoryId: eventItems.categoryId,
      lastOn: sql<string>`max(${events.occurredOn})`,
    })
    .from(eventItems)
    .innerJoin(events, eq(eventItems.eventId, events.id))
    .where(and(eq(events.deviceId, deviceId), eq(events.type, 'REPLACE')))
    .groupBy(eventItems.categoryId)
    .all()
  return new Map(rows.map((r) => [r.categoryId, r.lastOn]))
}

export interface CategoryDue {
  categoryId: number
  name: string
  color: string
  sort: number
  active: boolean
  notifyEnabled: boolean
  due: DueResult
  stock: number
  status: DueStatus
}

/**
 * 一次算好整台設備所有種類的到期狀態。
 *
 * 首頁狀態卡、挑選器的第一階、報表的泳道與通知掃描全部用這一個函式 ——
 * 到期日的算法只能有一份，否則畫面上顯示「剩 3 天」而通知說「已逾期」，
 * 使用者會不知道該信哪一個。
 */
export function categoryDues(deviceId: number, today: string): CategoryDue[] {
  const device = db.select().from(devices).where(eq(devices.id, deviceId)).get()
  const cats = db
    .select()
    .from(categories)
    .where(eq(categories.deviceId, deviceId))
    .orderBy(asc(categories.sort), asc(categories.id))
    .all()

  const lastReplaced = lastReplacedByCategory(deviceId)
  const stock = stockByCategory(deviceId)

  return cats.map((c) => {
    const due = computeDue({
      cyclePeriod: c.cyclePeriod,
      cycleUnit: c.cycleUnit,
      lastReplacedOn: lastReplaced.get(c.id) ?? null,
      baselineOn: c.baselineOn,
      deviceInstalledOn: device?.installedOn ?? null,
      today,
    })
    const s = stock.get(c.id) ?? 0
    return {
      categoryId: c.id,
      name: c.name,
      color: c.color,
      sort: c.sort,
      active: c.active,
      notifyEnabled: c.notifyEnabled,
      due,
      stock: s,
      status: dueStatus(due, s),
    }
  })
}

// ───────────────────────────── 成本 ─────────────────────────────

/** 每項耗材最後一次購買的單價與來源。挑選器顯示「上次 $NNN · 在 XX 買」 */
export interface LastPurchase {
  unitPrice: number | null
  vendor: string | null
  occurredOn: string
}

export function lastPurchaseByItem(deviceId: number): Map<number, LastPurchase> {
  const rows = db
    .select({
      itemId: eventItems.itemId,
      unitPrice: eventItems.unitPrice,
      vendor: events.vendor,
      occurredOn: events.occurredOn,
    })
    .from(eventItems)
    .innerJoin(events, eq(eventItems.eventId, events.id))
    .where(and(eq(events.deviceId, deviceId), eq(events.type, 'PURCHASE')))
    .orderBy(asc(events.occurredOn), asc(events.id))
    .all()

  // 依日期遞增掃過去，後面的覆蓋前面的 —— 最後留下的就是最近一次
  const map = new Map<number, LastPurchase>()
  for (const r of rows) {
    map.set(r.itemId, { unitPrice: r.unitPrice, vendor: r.vendor, occurredOn: r.occurredOn })
  }
  return map
}

/** 各種類的累計支出（僅計 PURCHASE 且有填單價的） */
export function costByCategory(deviceId: number): Map<number, number> {
  const rows = db
    .select({
      categoryId: eventItems.categoryId,
      total: sql<number>`sum(coalesce(${eventItems.unitPrice}, 0) * ${eventItems.qty})`,
    })
    .from(eventItems)
    .innerJoin(events, eq(eventItems.eventId, events.id))
    .where(and(eq(events.deviceId, deviceId), eq(events.type, 'PURCHASE')))
    .groupBy(eventItems.categoryId)
    .all()
  return new Map(rows.map((r) => [r.categoryId, r.total]))
}

/** 年度支出。`YYYY-MM-DD` 的字典序讓 like 'YYYY-%' 直接可用 */
export function costByYear(deviceId: number): { year: string; total: number }[] {
  return db
    .select({
      year: sql<string>`substr(${events.occurredOn}, 1, 4)`,
      total: sql<number>`sum(coalesce(${eventItems.unitPrice}, 0) * ${eventItems.qty})`,
    })
    .from(eventItems)
    .innerJoin(events, eq(eventItems.eventId, events.id))
    .where(and(eq(events.deviceId, deviceId), eq(events.type, 'PURCHASE')))
    .groupBy(sql`substr(${events.occurredOn}, 1, 4)`)
    .orderBy(desc(sql`substr(${events.occurredOn}, 1, 4)`))
    .all()
}

// ───────────────────────────── 範本 ─────────────────────────────

export interface Template {
  /** 用於去重與比對的鍵：排序後的 itemId:qty 組合 */
  key: string
  label: string
  lines: { itemId: number; categoryId: number; qty: number; itemName: string; categoryName: string }[]
  /** 這個組合最近出現的日期 */
  lastUsedOn: string
}

/**
 * 最近的更換組合，做成一鍵填滿的 chip。
 *
 * **這才是「30 秒完成」的真正來源** —— 大多數人每次換的就是同一組東西，
 * 讓他們重新在挑選器裡點六次，時間全花在重複勞動上。
 */
export function recentTemplates(deviceId: number, take = 3): Template[] {
  const recent = db
    .select()
    .from(events)
    .where(and(eq(events.deviceId, deviceId), eq(events.type, 'REPLACE')))
    .orderBy(desc(events.occurredOn), desc(events.id))
    .limit(10)
    .all()
  if (recent.length === 0) return []

  const withLines = attachLines(recent)
  const seen = new Map<string, Template>()

  for (const ev of withLines) {
    if (ev.lines.length === 0) continue
    const key = ev.lines
      .map((l) => `${l.itemId}:${l.qty}`)
      .sort()
      .join(',')
    if (seen.has(key)) continue

    const totalQty = ev.lines.reduce((s, l) => s + l.qty, 0)
    seen.set(key, {
      key,
      label:
        ev.lines.length <= 3
          ? ev.lines.map((l) => `${l.categoryName}×${l.qty}`).join(' ')
          : `全換 · ${totalQty} 項`,
      lines: ev.lines.map((l) => ({
        itemId: l.itemId,
        categoryId: l.categoryId,
        qty: l.qty,
        itemName: l.itemName,
        categoryName: l.categoryName,
      })),
      lastUsedOn: ev.occurredOn,
    })
    if (seen.size >= take) break
  }
  return [...seen.values()]
}

/**
 * 這些明細是否全部屬於這台設備。
 *
 * 客戶端送來的 itemId 與 categoryId 各自合法，但**組合起來未必屬於同一台設備** ——
 * zod 驗的是形狀，擋不住這種「形狀正確但關係不對」的輸入。
 * 不擋的話可以把 A 機的濾心記到 B 機的更換紀錄上：
 * 兩邊的庫存與到期日都會算錯，而且沒有任何錯誤訊息。
 *
 * 順便驗 categoryId 與該耗材當下的種類一致 —— 那個欄位是快照，
 * 但快照的初始值必須是真的。
 */
export function validateLines(
  deviceId: number,
  lines: { itemId: number; categoryId: number }[],
): string | null {
  if (lines.length === 0) return null
  const owned = db
    .select({ itemId: items.id, categoryId: items.categoryId, itemName: items.name })
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(and(eq(categories.deviceId, deviceId), inArray(items.id, lines.map((l) => l.itemId))))
    .all()
  const byItem = new Map(owned.map((r) => [r.itemId, r]))

  for (const l of lines) {
    const hit = byItem.get(l.itemId)
    if (!hit) return `耗材 #${l.itemId} 不屬於這台設備`
    if (hit.categoryId !== l.categoryId) {
      return `「${hit.itemName}」的種類對不上，請重新選一次`
    }
  }
  return null
}

// ───────────────────────── 寫入（含 reading 連動）─────────────────────────

export interface EventLineInput {
  itemId: number
  categoryId: number
  qty: number
  unitPrice: number | null
}

export interface EventWriteInput {
  type: 'PURCHASE' | 'REPLACE' | 'ADJUST'
  occurredOn: string
  vendor: string | null
  note: string | null
  lines: EventLineInput[]
  /** 只有 REPLACE 會帶。兩個都是 null 代表當天沒量 */
  rawPpm: number | null
  purePpm: number | null
}

/**
 * 新增事件。event → eventItems →（有 PPM 才）reading，全部在一個 transaction 裡。
 *
 * PPM 只存在 `readings` 一張表，`events` 沒有 PPM 欄位 ——
 * 這把「兩份資料要同步」的問題轉成「誰擁有這筆資料」的問題，
 * 而後者只要決定一次就永遠不會不一致。
 */
export function createEventTx(deviceId: number, input: EventWriteInput): number {
  return db.transaction((tx) => {
    const ev = tx
      .insert(events)
      .values({
        deviceId,
        type: input.type,
        occurredOn: input.occurredOn,
        vendor: input.vendor,
        note: input.note,
      })
      .returning({ id: events.id })
      .get()

    tx.insert(eventItems)
      .values(
        input.lines.map((l) => ({
          eventId: ev.id,
          itemId: l.itemId,
          categoryId: l.categoryId,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
      )
      .run()

    if (input.type === 'REPLACE' && input.rawPpm !== null && input.purePpm !== null) {
      tx.insert(readings)
        .values({
          deviceId,
          measuredOn: input.occurredOn,
          rawPpm: input.rawPpm,
          purePpm: input.purePpm,
          source: 'REPLACE',
          eventId: ev.id,
        })
        .run()
    }

    return ev.id
  })
}

/**
 * 編輯事件。
 *
 * 明細採「刪光重建」而不是逐列比對：一筆事件不到十列，
 * 而逐列比對要處理新增、刪除、改數量三種情況，是三倍的程式碼與三倍的出錯機會。
 *
 * **reading 的 update 分支一定要一併更新 `measuredOn`。**
 * 這是整個連動裡最容易漏的一行 —— 漏了之後改事件日期，
 * 資料庫看起來完全正常（reading 還在、PPM 也對），
 * 但報表上那個點會留在舊位置，而使用者要對照日曆才會發現。
 */
export function updateEventTx(eventId: number, input: EventWriteInput): void {
  db.transaction((tx) => {
    const existing = tx.select().from(events).where(eq(events.id, eventId)).get()
    if (!existing) throw new Error(`事件 ${eventId} 不存在`)

    tx.update(events)
      .set({
        type: input.type,
        occurredOn: input.occurredOn,
        vendor: input.vendor,
        note: input.note,
        updatedAt: Date.now(),
      })
      .where(eq(events.id, eventId))
      .run()

    tx.delete(eventItems).where(eq(eventItems.eventId, eventId)).run()
    tx.insert(eventItems)
      .values(
        input.lines.map((l) => ({
          eventId,
          itemId: l.itemId,
          categoryId: l.categoryId,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
      )
      .run()

    const hasPpm =
      input.type === 'REPLACE' && input.rawPpm !== null && input.purePpm !== null
    const current = tx.select().from(readings).where(eq(readings.eventId, eventId)).get()

    if (!hasPpm) {
      // PPM 被清空（或型別改成 PURCHASE）→ 刪掉那筆 reading
      if (current) tx.delete(readings).where(eq(readings.id, current.id)).run()
      return
    }

    if (current) {
      tx.update(readings)
        .set({
          // ↓ 這一行就是重點。漏了它，改事件日期後圖上的點不會跟著移動
          measuredOn: input.occurredOn,
          rawPpm: input.rawPpm!,
          purePpm: input.purePpm!,
          updatedAt: Date.now(),
        })
        .where(eq(readings.id, current.id))
        .run()
    } else {
      tx.insert(readings)
        .values({
          deviceId: existing.deviceId,
          measuredOn: input.occurredOn,
          rawPpm: input.rawPpm!,
          purePpm: input.purePpm!,
          source: 'REPLACE',
          eventId,
        })
        .run()
    }
  })
}

/** 刪事件。reading 與 eventItems 由 cascade 處理 */
export function deleteEventTx(eventId: number): void {
  db.delete(events).where(eq(events.id, eventId)).run()
}

// ───────────────────────── 挑選器的資料組裝 ─────────────────────────

/**
 * 兩階挑選器要的資料，一次算好傳給客戶端。
 *
 * 只帶**啟用中**的種類與耗材 —— 停用的東西出現在挑選器裡就失去了停用的意義。
 * 順序刻意是「逾期優先、其餘照設定的順序」：挑選器同時是待辦清單，
 * 該換的東西必須在最上面。
 */
export function buildPickerCategories(deviceId: number, today: string): PickerCategory[] {
  const dues = categoryDues(deviceId, today).filter((d) => d.active)
  const itemStock = stockByItem(deviceId)
  const lastBuy = lastPurchaseByItem(deviceId)

  const allItems = db
    .select()
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(and(eq(categories.deviceId, deviceId), eq(items.active, true)))
    .orderBy(asc(items.name))
    .all()
    .map((r) => r.items)

  const byCategory = new Map<number, typeof allItems>()
  for (const it of allItems) {
    const arr = byCategory.get(it.categoryId) ?? []
    arr.push(it)
    byCategory.set(it.categoryId, arr)
  }

  const rows = dues.map((d) => ({
    id: d.categoryId,
    name: d.name,
    color: d.color,
    stock: d.stock,
    overdueDays: d.due.overdue ? Math.abs(d.due.daysLeft!) : null,
    daysLeft: d.due.daysLeft,
    statusLabel: statusText(d),
    sort: d.sort,
    items: (byCategory.get(d.categoryId) ?? []).map((it) => ({
      id: it.id,
      name: it.name,
      brand: it.brand,
      defaultQty: it.defaultQty,
      stock: itemStock.get(it.id) ?? 0,
      lastPurchaseLabel: purchaseText(lastBuy.get(it.id)),
    })),
  }))

  // 逾期的排最前面，逾期越久越前面；其餘照種類設定的順序
  return rows
    .sort((a, b) => {
      if (a.overdueDays !== null || b.overdueDays !== null) {
        return (b.overdueDays ?? -1) - (a.overdueDays ?? -1)
      }
      return a.sort - b.sort
    })
    .map(({ sort: _sort, ...rest }) => rest)
}

function statusText(d: CategoryDue): string {
  switch (d.status) {
    case 'OVERDUE':
      return `逾期 ${Math.abs(d.due.daysLeft!)} 天`
    case 'SOON':
      return d.due.daysLeft === 0 ? '今天到期' : `剩 ${d.due.daysLeft} 天`
    case 'OK':
      return `剩 ${d.due.daysLeft} 天`
    case 'PURCHASED':
      return '已購入待換'
    case 'UNSET':
      return d.due.basis === 'NONE' ? '未設起算日' : '未設週期'
  }
}

function purchaseText(p: LastPurchase | undefined): string | null {
  if (!p) return null
  const price = p.unitPrice != null ? `上次 $${p.unitPrice}` : '上次'
  return p.vendor ? `${price} · 在${p.vendor}買` : price
}
