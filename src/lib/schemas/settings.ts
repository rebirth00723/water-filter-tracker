import { z } from 'zod'
import { CYCLE_UNITS } from '@/lib/db/schema'
import {
  dbId,
  hexColor,
  optionalNtfyTopic,
  optionalDate,
  optionalPositiveInt,
  optionalText,
  positiveInt,
  requiredText,
} from './common'

/** 週期上限依單位而不同：3650 天 ≈ 10 年、120 個月 = 10 年 */
export const MAX_CYCLE = { DAY: 3650, MONTH: 120 } as const

// ───────────────────────────── 設備 ─────────────────────────────

/** 表單欄位。與 action 的輸入分開，因為 `id` 不是表單欄位而是程式傳入的 */
export const deviceFields = z.object({
  name: requiredText(40, '設備名稱'),
  model: optionalText(60),
  /** 起算日備援 #3：種類與更換紀錄都沒有起算日時，用裝機日推算 */
  installedOn: optionalDate,
  /**
   * 留空＝沿用全域 topic。安全事件不綁設備，所以這裡只影響濾心提醒。
   * 用與發送端同一條規則驗證，否則存得進去但每次發送都必定失敗。
   */
  ntfyTopic: optionalNtfyTopic,
  active: z.boolean(),
})

export const createDevice = deviceFields
export const updateDevice = deviceFields.extend({ id: dbId })
export const deviceRef = z.object({ id: dbId })

/** 設備排序：一次送整份順序，避免「上移／下移」在併發下互相蓋掉 */
export const reorderDevices = z.object({ ids: z.array(dbId).min(1) })

// ───────────────────────────── 種類 ─────────────────────────────

export const categoryFields = z.object({
  name: requiredText(20, '種類名稱'),
  color: hexColor,
  /** null＝不設週期。設了才會出現在到期提醒與泳道的下次更換日 */
  cyclePeriod: optionalPositiveInt(MAX_CYCLE.DAY, '週期'),
  cycleUnit: z.enum(CYCLE_UNITS),
  /** 起算日備援 #2：「裝機時就換過」 */
  baselineOn: optionalDate,
  notifyEnabled: z.boolean(),
  active: z.boolean(),
})

/**
 * 週期上限依單位而不同，所以只能在兩個欄位都到手之後才驗 ——
 * 這正是 superRefine 存在的理由，單一欄位的 max() 做不到。
 *
 * 必須先 extend 再 refine：refine 之後拿到的不再是 ZodObject，沒有 extend()。
 */
const cycleWithinUnitLimit = (v: { cyclePeriod: number | null; cycleUnit: 'DAY' | 'MONTH' }, ctx: z.RefinementCtx) => {
  if (v.cyclePeriod === null) return
  const max = MAX_CYCLE[v.cycleUnit]
  if (v.cyclePeriod > max) {
    ctx.addIssue({
      code: 'custom',
      path: ['cyclePeriod'],
      message: `以${v.cycleUnit === 'DAY' ? '天' : '月'}為單位時最多 ${max}`,
    })
  }
}

/**
 * 表單用的版本。**必須也帶 superRefine** ——
 * 少了它，週期上限就只有伺服端會擋，使用者要送出之後才會看到一則 toast，
 * 而不是欄位旁的即時提示。共用 schema 的意義就在於兩邊規則不會漂移，
 * 只在 action 那一側加檢查等於自己放棄了這件事。
 */
export const categoryFormSchema = categoryFields.superRefine(cycleWithinUnitLimit)

export const createCategory = categoryFields
  .extend({ deviceId: dbId })
  .superRefine(cycleWithinUnitLimit)
export const updateCategory = categoryFields.extend({ id: dbId }).superRefine(cycleWithinUnitLimit)
export const categoryRef = z.object({ id: dbId })
export const reorderCategories = z.object({ deviceId: dbId, ids: z.array(dbId).min(1) })

// ───────────────────────────── 耗材 ─────────────────────────────

export const itemFields = z.object({
  name: requiredText(40, '耗材名稱'),
  brand: optionalText(40),
  /** 更換表單的預設數量，省掉最常見的那一次點擊 */
  defaultQty: positiveInt(99, '預設數量'),
  active: z.boolean(),
})

export const createItem = itemFields.extend({ categoryId: dbId })
export const updateItem = itemFields.extend({ id: dbId })
export const itemRef = z.object({ id: dbId })

export type DeviceFormValues = z.input<typeof deviceFields>
export type CategoryFormValues = z.input<typeof categoryFields>
export type ItemFormValues = z.input<typeof itemFields>
