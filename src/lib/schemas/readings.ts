import { z } from 'zod'
import { dbId, nonNegativeInt, optionalText, requiredDate } from './common'

/** TDS 筆的量測上限。市面上的手持機幾乎都是 0–9999 ppm */
export const MAX_PPM = 9999

/**
 * 純水不得高於原水的檢查放在 superRefine，因為它需要兩個欄位都到手。
 *
 * 這條規則抓的是實際會發生的手誤：站在水槽邊量完原水、換杯子量純水，
 * 兩個數字填反的機率不低 —— 而填反之後圖上的兩條線會交叉，
 * 看起來像濾心壞掉，是最容易誤判的一種髒資料。
 */
const purityOrder = (
  v: { rawPpm: number; purePpm: number },
  ctx: z.RefinementCtx,
) => {
  if (v.purePpm > v.rawPpm) {
    ctx.addIssue({
      code: 'custom',
      path: ['purePpm'],
      message: `純水（${v.purePpm}）不該高於原水（${v.rawPpm}），兩個數字是不是填反了？`,
    })
  }
}

export const readingFields = z.object({
  measuredOn: requiredDate,
  rawPpm: nonNegativeInt(MAX_PPM, '原水 PPM'),
  purePpm: nonNegativeInt(MAX_PPM, '純水 PPM'),
  note: optionalText(200),
})

export const readingFormSchema = readingFields.superRefine(purityOrder)

export const createReading = readingFields
  .extend({ deviceId: dbId })
  .superRefine(purityOrder)

export const updateReading = readingFields.extend({ id: dbId }).superRefine(purityOrder)

/**
 * 更換紀錄擁有的那筆 PPM 只能改數值，不能改日期。
 *
 * 日期由事件擁有 —— 在這裡也能改的話，同一個「日期」就有兩個擁有者，
 * 而使用者無法預期哪一邊會贏。要改日期就去改那筆更換紀錄，
 * upsert 會把 reading 的日期一起帶過去。
 */
export const updateEventReading = z
  .object({
    id: dbId,
    rawPpm: nonNegativeInt(MAX_PPM, '原水 PPM'),
    purePpm: nonNegativeInt(MAX_PPM, '純水 PPM'),
    note: optionalText(200),
  })
  .superRefine(purityOrder)

export const readingRef = z.object({ id: dbId })

export type ReadingFormValues = z.input<typeof readingFields>
