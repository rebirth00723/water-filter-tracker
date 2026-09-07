import { z } from 'zod'
import { dbId, optionalNonNegativeInt, optionalText, requiredDate } from './common'
import { MAX_PPM } from './readings'

export const MAX_QTY = 99
export const MAX_UNIT_PRICE = 999_999

/**
 * 明細一列。
 *
 * `qty` 用真正的 number 而不是字串：它來自 [−] 1 [+] 步進器而不是文字框，
 * 照實宣告比為了和其他欄位一致而硬轉成字串誠實。
 */
const line = z.object({
  itemId: dbId,
  /** 種類是快照 —— 耗材日後搬到別的種類，歷史紀錄不可以跟著改寫 */
  categoryId: dbId,
  qty: z.number().int().min(1, '數量至少為 1').max(MAX_QTY, `數量最多為 ${MAX_QTY}`),
  /** 單價（新台幣元）。僅 PURCHASE 使用，留空代表沒記 */
  unitPrice: optionalNonNegativeInt(MAX_UNIT_PRICE, '單價'),
})

const purchaseShape = {
  type: z.literal('PURCHASE'),
  occurredOn: requiredDate,
  /** 購買來源：店家名稱或連結 */
  vendor: optionalText(120),
  note: optionalText(200),
  lines: z.array(line).min(1, '至少要有一項耗材'),
}

const replaceShape = {
  type: z.literal('REPLACE'),
  occurredOn: requiredDate,
  note: optionalText(200),
  /*
   * PPM 只出現在 REPLACE 分支 —— 這不是「在 PURCHASE 時隱藏」，
   * 而是它在 PURCHASE 的型別與 payload 裡根本不存在。
   * 隱藏欄位仍然會被送出、仍然要在伺服端記得忽略；不存在就沒有這個問題。
   */
  rawPpm: optionalNonNegativeInt(MAX_PPM, '原水 PPM'),
  purePpm: optionalNonNegativeInt(MAX_PPM, '純水 PPM'),
  lines: z.array(line).min(1, '至少要有一項耗材'),
}

type Parsed =
  | { type: 'PURCHASE'; lines: { itemId: number; qty: number }[] }
  | {
      type: 'REPLACE'
      rawPpm: number | null
      purePpm: number | null
      lines: { itemId: number; qty: number }[]
    }

/**
 * 跨欄位檢查放在 union 外層，因為它們要看到整筆資料。
 */
function crossChecks(v: Parsed, ctx: z.RefinementCtx) {
  // 同一筆事件不可重複同一項耗材：資料庫有 ei_event_item_uq 唯一索引，
  // 撞到會丟出 SQLITE_CONSTRAINT，而那不該出現在使用者眼前。
  // UI 會在重複挑選時合併數量，但伺服端不能假設客戶端做對了。
  const seen = new Set<number>()
  v.lines.forEach((l, i) => {
    if (seen.has(l.itemId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['lines', i, 'itemId'],
        message: '同一筆紀錄裡重複了同一項耗材，請改成調整數量',
      })
    }
    seen.add(l.itemId)
  })

  if (v.type !== 'REPLACE') return

  // PPM 必須成對：只填一個的話圖上會出現一個沒有對照的點，
  // 而去除率算不出來 —— 那筆資料等於白填
  const filled = [v.rawPpm !== null, v.purePpm !== null]
  if (filled[0] !== filled[1]) {
    ctx.addIssue({
      code: 'custom',
      path: [v.rawPpm === null ? 'rawPpm' : 'purePpm'],
      message: '原水與純水要一起填。只填一個的話算不出去除率，這筆水質紀錄沒有用',
    })
    return
  }

  if (v.rawPpm !== null && v.purePpm !== null && v.purePpm > v.rawPpm) {
    ctx.addIssue({
      code: 'custom',
      path: ['purePpm'],
      message: `純水（${v.purePpm}）不該高於原水（${v.rawPpm}），兩個數字是不是填反了？`,
    })
  }
}

/*
 * 三個 union 寫開來，不用泛型工廠。
 *
 * 泛型版（`eventUnion<E extends ZodRawShape>(extra: E)`）會讓 zod 的推導
 * 在其中一個分支塌成 `Record<string, unknown>`，於是 superRefine 的參數型別
 * 對不上，只能用 `as never` 硬轉 —— 那等於把跨欄位檢查的型別安全整個關掉。
 *
 * 寫開來雖然重複三次，但重複的只有「多帶哪個欄位」那一行；
 * purchaseShape/replaceShape 是共用常數，加欄位三處會自動跟上。
 */
export const eventFormSchema = z
  .discriminatedUnion('type', [z.object(purchaseShape), z.object(replaceShape)])
  .superRefine(crossChecks)

/**
 * 表單用的單一分支 schema。
 *
 * 表單本身是**扁平的**（使用者用一個切換鈕在新購／更換之間切，欄位大部分共用），
 * 所以驗證時依當下的 type 選一個分支，而不是餵一個 union 給 react-hook-form ——
 * union 會讓 `register('vendor')` 在型別上失效，因為那個欄位只存在其中一個分支。
 *
 * 兩個分支與伺服端的 createEvent/updateEvent 用的是同一組 shape 與同一份
 * crossChecks，所以規則不會漂移。zod 預設會剝掉未知的鍵，
 * 因此表單多送的欄位（更換時的 vendor）會被自動忽略，不需要在送出前手動清理。
 */
export const purchaseFormSchema = z.object(purchaseShape).superRefine(crossChecks)
export const replaceFormSchema = z.object(replaceShape).superRefine(crossChecks)

export const createEvent = z
  .discriminatedUnion('type', [
    z.object({ ...purchaseShape, deviceId: dbId }),
    z.object({ ...replaceShape, deviceId: dbId }),
  ])
  .superRefine(crossChecks)

export const updateEvent = z
  .discriminatedUnion('type', [
    z.object({ ...purchaseShape, id: dbId }),
    z.object({ ...replaceShape, id: dbId }),
  ])
  .superRefine(crossChecks)

export const eventRef = z.object({ id: dbId })

export type EventFormValues = z.input<typeof eventFormSchema>
export type EventLineValues = z.input<typeof line>
