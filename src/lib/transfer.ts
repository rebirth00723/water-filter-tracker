import 'server-only'
import { z } from 'zod'
import { db } from './db'
import {
  CYCLE_UNITS,
  EVENT_TYPES,
  NOTIFY_RULE_KINDS,
  READING_SOURCES,
  categories,
  devices,
  eventItems,
  events,
  items,
  notifyRules,
  readings,
  settings,
} from './db/schema'

/**
 * JSON 匯出與匯入。成對提供 —— 只有匯出沒有匯入，遷移只完成一半。
 *
 * **範圍刻意排除認證與稽核資料**，三個理由：
 * 1. passkey 憑證綁定 RP ID，換機器換網域就失效，匯過去沒有意義。
 * 2. 能匯入他人憑證檔的功能等於一條後門，不該存在。
 * 3. audit_log 是「這台機器上發生過什麼」的紀錄，混入別台的會讓它失去可信度。
 *
 * `machine_config` 也不含：那裡放的是 ntfy 認證與站台專屬值，匯出等於外洩。
 * `notify_log` 不帶入，讓新機器自行重新判斷該送什麼；
 * 否則舊的已送紀錄會壓住新機器的提醒。
 */

export const EXPORT_FORMAT = 'water-filter-tracker'
export const EXPORT_VERSION = 1

const ymd = z.iso.date()

/*
 * 匯入的 JSON 是使用者上傳的檔案 —— 不可信輸入，逐欄驗證。
 * 這裡刻意不重用 src/lib/schemas/ 底下那些表單 schema：
 * 那些的輸入型別是「表單送來的字串」，而這裡是 JSON 的原生型別，
 * 硬要共用會讓兩邊都變得難讀。
 */
const deviceIn = z.object({
  id: z.number().int(),
  name: z.string().min(1).max(40),
  model: z.string().max(60).nullable().default(null),
  installedOn: ymd.nullable().default(null),
  /**
   * 設備專屬 ntfy topic。
   *
   * **匯入時接受、匯出時不帶。** UI 明寫「不含 ntfy 的連線與認證」，
   * 而 topic 在開放式 ntfy 伺服器上等同密碼（知道名稱就能訂閱與發布）——
   * 匯出檔常常會被傳來傳去，不該夾帶它。
   * 匯入端保留這個欄位是為了讓手改過的檔案仍然可用。
   */
  ntfyTopic: z.string().max(80).nullable().default(null),
  sort: z.number().int().default(0),
  active: z.boolean().default(true),
})

const categoryIn = z.object({
  id: z.number().int(),
  deviceId: z.number().int(),
  name: z.string().min(1).max(20),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sort: z.number().int().default(0),
  cyclePeriod: z.number().int().positive().nullable().default(null),
  cycleUnit: z.enum(CYCLE_UNITS).default('MONTH'),
  baselineOn: ymd.nullable().default(null),
  stageKey: z.string().max(20).nullable().default(null),
  coversStages: z.string().max(60).default(''),
  notifyEnabled: z.boolean().default(true),
  active: z.boolean().default(true),
})

const itemIn = z.object({
  id: z.number().int(),
  categoryId: z.number().int(),
  name: z.string().min(1).max(40),
  brand: z.string().max(40).nullable().default(null),
  defaultQty: z.number().int().min(1).max(99).default(1),
  active: z.boolean().default(true),
})

const eventIn = z.object({
  id: z.number().int(),
  deviceId: z.number().int(),
  type: z.enum(EVENT_TYPES),
  occurredOn: ymd,
  vendor: z.string().max(120).nullable().default(null),
  note: z.string().max(200).nullable().default(null),
})

const eventItemIn = z.object({
  eventId: z.number().int(),
  itemId: z.number().int(),
  categoryId: z.number().int(),
  qty: z.number().int(),
  unitPrice: z.number().int().nullable().default(null),
})

const readingIn = z.object({
  id: z.number().int(),
  deviceId: z.number().int(),
  measuredOn: ymd,
  rawPpm: z.number().int().min(0),
  purePpm: z.number().int().min(0),
  source: z.enum(READING_SOURCES).default('MANUAL'),
  eventId: z.number().int().nullable().default(null),
  note: z.string().max(200).nullable().default(null),
})

const notifyRuleIn = z
  .object({
    kind: z.enum(NOTIFY_RULE_KINDS),
    offsetDays: z.number().int().min(0).max(365).nullable().default(null),
    repeatDays: z.number().int().min(1).max(365).nullable().default(null),
    template: z.string().min(1).max(400),
    priority: z.number().int().min(1).max(5).default(3),
    /**
     * 逐條的發送時刻。**這個欄位一度漏掉** —— 於是換一台機器之後，
     * 每條規則的自訂時刻都靜默退回全域預設，而「當天到期要在出門前收到」
     * 這種設定就這樣消失了，使用者不會發現。
     */
    sendTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .default(null),
    enabled: z.boolean().default(true),
  })
  /*
   * 與表單 schema 同一條交叉檢查（見 lib/schemas/notify.ts）。
   * 少了它，匯入可以造出 UI 造不出來的規則 —— 例如一條沒有天數的
   * ADVANCE，它永遠不知道什麼時候該送。
   */
  .refine((v) => (v.kind === 'ADVANCE' ? v.offsetDays !== null : v.repeatDays !== null), {
    message: 'ADVANCE 規則需要 offsetDays，OVERDUE 規則需要 repeatDays',
  })

export const importPayload = z.object({
  format: z.literal(EXPORT_FORMAT),
  /** 目前只有 1。之後改格式時在這裡分流，舊檔案仍要能匯入 */
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string().optional(),
  devices: z.array(deviceIn),
  categories: z.array(categoryIn),
  items: z.array(itemIn),
  events: z.array(eventIn),
  eventItems: z.array(eventItemIn),
  readings: z.array(readingIn),
  notifyRules: z.array(notifyRuleIn).default([]),
  settings: z.array(z.object({ key: z.string().max(60), value: z.string().max(400) })).default([]),
})

export type ImportPayload = z.infer<typeof importPayload>

// ───────────────────────────── 匯出 ─────────────────────────────

export function exportAll(): ImportPayload {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    // ntfyTopic 刻意不匯出，見 deviceIn 的說明
    devices: db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        installedOn: devices.installedOn,
        sort: devices.sort,
        active: devices.active,
      })
      .from(devices)
      .all()
      .map((d) => ({ ...d, ntfyTopic: null })),
    categories: db
      .select({
        id: categories.id,
        deviceId: categories.deviceId,
        name: categories.name,
        color: categories.color,
        sort: categories.sort,
        cyclePeriod: categories.cyclePeriod,
        cycleUnit: categories.cycleUnit,
        baselineOn: categories.baselineOn,
        stageKey: categories.stageKey,
        coversStages: categories.coversStages,
        notifyEnabled: categories.notifyEnabled,
        active: categories.active,
      })
      .from(categories)
      .all(),
    items: db
      .select({
        id: items.id,
        categoryId: items.categoryId,
        name: items.name,
        brand: items.brand,
        defaultQty: items.defaultQty,
        active: items.active,
      })
      .from(items)
      .all(),
    events: db
      .select({
        id: events.id,
        deviceId: events.deviceId,
        type: events.type,
        occurredOn: events.occurredOn,
        vendor: events.vendor,
        note: events.note,
      })
      .from(events)
      .all(),
    eventItems: db
      .select({
        eventId: eventItems.eventId,
        itemId: eventItems.itemId,
        categoryId: eventItems.categoryId,
        qty: eventItems.qty,
        unitPrice: eventItems.unitPrice,
      })
      .from(eventItems)
      .all(),
    readings: db
      .select({
        id: readings.id,
        deviceId: readings.deviceId,
        measuredOn: readings.measuredOn,
        rawPpm: readings.rawPpm,
        purePpm: readings.purePpm,
        source: readings.source,
        eventId: readings.eventId,
        note: readings.note,
      })
      .from(readings)
      .all(),
    notifyRules: db
      .select({
        kind: notifyRules.kind,
        offsetDays: notifyRules.offsetDays,
        repeatDays: notifyRules.repeatDays,
        template: notifyRules.template,
        priority: notifyRules.priority,
        sendTime: notifyRules.sendTime,
        enabled: notifyRules.enabled,
      })
      .from(notifyRules)
      .all(),
    settings: db.select({ key: settings.key, value: settings.value }).from(settings).all(),
  }
}

// ───────────────────────────── 匯入 ─────────────────────────────

export type ImportMode = 'replace' | 'merge'

export interface ImportResult {
  mode: ImportMode
  devices: number
  categories: number
  items: number
  events: number
  readings: number
  skipped: string[]
}

/**
 * 匯入。
 *
 * 兩種模式的語意刻意講得很白，因為「合併」在不同工具裡意思差很多：
 *
 * - **取代**：清空範圍內的資料再匯入。給遷移用 —— 這是主要用途。
 * - **合併**：把匯入檔裡的設備當成**新設備**加進來，id 全部重新配發。
 *   給「兩台機器各記了一段，想併成一份」用。
 *   不會嘗試比對同名設備 —— 那種猜測一旦猜錯，使用者要花更久才發現。
 *
 * 合併模式**不帶入 notify_rules 與 settings**：那些是這台機器的偏好，
 * 重複匯入通知規則會讓每一則提醒送兩次。
 */
/**
 * 匯入檔裡的 id 必須唯一。
 *
 * 不檢查的話，一份重複了 device id 的檔案會讓後面那筆覆蓋 map 裡的前一筆，
 * 於是前一台設備的所有種類、事件與水質紀錄**靜默接到後一台上** ——
 * 資料沒有遺失但全部長錯地方，而且沒有任何錯誤訊息。
 * 這種檔案只會來自手改或別的工具產生，正因如此更該擋。
 */
function assertUniqueIds(payload: ImportPayload): void {
  const groups: [string, { id: number }[]][] = [
    ['設備', payload.devices],
    ['種類', payload.categories],
    ['耗材', payload.items],
    ['事件', payload.events],
    ['水質紀錄', payload.readings],
  ]
  for (const [label, rows] of groups) {
    const seen = new Set<number>()
    for (const r of rows) {
      if (seen.has(r.id)) {
        throw new Error(`匯入檔裡有重複的${label} id：${r.id}。這份檔案的關聯無法可靠地還原。`)
      }
      seen.add(r.id)
    }
  }
}

export function importAll(payload: ImportPayload, mode: ImportMode): ImportResult {
  const skipped: string[] = []
  assertUniqueIds(payload)

  return db.transaction((tx) => {
    if (mode === 'replace') {
      // 由子到父刪除。foreign_keys = ON 之下順序錯了會被拒絕
      tx.delete(eventItems).run()
      tx.delete(readings).run()
      tx.delete(events).run()
      tx.delete(items).run()
      tx.delete(categories).run()
      tx.delete(devices).run()
      tx.delete(notifyRules).run()
      tx.delete(settings).run()
    } else {
      skipped.push('通知規則與偏好設定（合併模式下保留這台機器自己的）')
    }

    // 舊 id → 新 id。匯入檔的 id 不可能直接沿用（合併時會撞，取代時也不保證連續）
    const deviceMap = new Map<number, number>()
    const categoryMap = new Map<number, number>()
    const itemMap = new Map<number, number>()
    const eventMap = new Map<number, number>()

    for (const d of payload.devices) {
      const row = tx
        .insert(devices)
        .values({
          name: d.name,
          model: d.model,
          installedOn: d.installedOn,
          ntfyTopic: d.ntfyTopic,
          sort: d.sort,
          active: d.active,
        })
        .returning({ id: devices.id })
        .get()
      deviceMap.set(d.id, row.id)
    }

    for (const c of payload.categories) {
      const deviceId = deviceMap.get(c.deviceId)
      if (deviceId === undefined) {
        skipped.push(`種類「${c.name}」：找不到它的設備`)
        continue
      }
      const row = tx
        .insert(categories)
        .values({
          deviceId,
          name: c.name,
          color: c.color,
          sort: c.sort,
          cyclePeriod: c.cyclePeriod,
          cycleUnit: c.cycleUnit,
          baselineOn: c.baselineOn,
          stageKey: c.stageKey,
          coversStages: c.coversStages,
          notifyEnabled: c.notifyEnabled,
          active: c.active,
        })
        .returning({ id: categories.id })
        .get()
      categoryMap.set(c.id, row.id)
    }

    for (const it of payload.items) {
      const categoryId = categoryMap.get(it.categoryId)
      if (categoryId === undefined) {
        skipped.push(`耗材「${it.name}」：找不到它的種類`)
        continue
      }
      const row = tx
        .insert(items)
        .values({
          categoryId,
          name: it.name,
          brand: it.brand,
          defaultQty: it.defaultQty,
          active: it.active,
        })
        .returning({ id: items.id })
        .get()
      itemMap.set(it.id, row.id)
    }

    for (const e of payload.events) {
      const deviceId = deviceMap.get(e.deviceId)
      if (deviceId === undefined) {
        skipped.push(`${e.occurredOn} 的事件：找不到它的設備`)
        continue
      }
      const row = tx
        .insert(events)
        .values({
          deviceId,
          type: e.type,
          occurredOn: e.occurredOn,
          vendor: e.vendor,
          note: e.note,
        })
        .returning({ id: events.id })
        .get()
      eventMap.set(e.id, row.id)
    }

    for (const l of payload.eventItems) {
      const eventId = eventMap.get(l.eventId)
      const itemId = itemMap.get(l.itemId)
      const categoryId = categoryMap.get(l.categoryId)
      if (eventId === undefined || itemId === undefined || categoryId === undefined) {
        skipped.push(`一筆事件明細：對應的事件、耗材或種類不在匯入檔裡`)
        continue
      }
      tx.insert(eventItems)
        .values({ eventId, itemId, categoryId, qty: l.qty, unitPrice: l.unitPrice })
        .run()
    }

    for (const r of payload.readings) {
      const deviceId = deviceMap.get(r.deviceId)
      if (deviceId === undefined) {
        skipped.push(`${r.measuredOn} 的水質紀錄：找不到它的設備`)
        continue
      }
      // eventId 對不上時降級成手動紀錄而不是整筆丟掉 ——
      // PPM 是使用者親手量的，不該因為關聯壞了就消失
      const mapped = r.eventId === null ? null : (eventMap.get(r.eventId) ?? null)
      tx.insert(readings)
        .values({
          deviceId,
          measuredOn: r.measuredOn,
          rawPpm: r.rawPpm,
          purePpm: r.purePpm,
          source: mapped === null ? 'MANUAL' : r.source,
          eventId: mapped,
          note: r.note,
        })
        .run()
    }

    if (mode === 'replace') {
      if (payload.notifyRules.length > 0) tx.insert(notifyRules).values(payload.notifyRules).run()
      if (payload.settings.length > 0) tx.insert(settings).values(payload.settings).run()
    }

    return {
      mode,
      devices: deviceMap.size,
      categories: categoryMap.size,
      items: itemMap.size,
      events: eventMap.size,
      readings: payload.readings.length,
      skipped,
    }
  })
}
