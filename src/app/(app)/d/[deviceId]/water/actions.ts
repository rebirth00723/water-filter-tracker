'use server'

import { eq } from 'drizzle-orm'
import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { readings } from '@/lib/db/schema'
import { getDevice } from '@/lib/devices'
import { getReading } from '@/lib/readings-store'
import { ActionError, authedAction } from '@/lib/safe-action'
import {
  createReading,
  readingRef,
  updateEventReading,
  updateReading,
} from '@/lib/schemas/readings'

/**
 * 水質紀錄的寫入。
 *
 * 這一階段的重點不是功能複雜度（三個欄位而已），而是**把整條路徑除錯乾淨**：
 * Server Action → zod → 字串日期 → refresh。之後的更換紀錄與通知都走同一條，
 * 在最簡單的畫面上把模式定下來，比在最複雜的畫面上邊做邊改便宜得多。
 */

export const addReading = authedAction
  .metadata({ name: 'reading.create' })
  .inputSchema(createReading)
  .action(async ({ parsedInput: { deviceId, ...fields }, ctx }) => {
    const device = getDevice(deviceId)
    if (!device) throw new ActionError('找不到這台設備，可能已經被刪除')

    const row = db
      .insert(readings)
      .values({ ...fields, deviceId, source: 'MANUAL' })
      .returning()
      .get()

    ctx.audit({
      entity: 'reading',
      entityId: row.id,
      summary: `記錄「${device.name}」${row.measuredOn} 的水質：原水 ${row.rawPpm} / 純水 ${row.purePpm} ppm`,
      after: row,
    })
    refresh()
    return { id: row.id, measuredOn: row.measuredOn }
  })

export const editReading = authedAction
  .metadata({ name: 'reading.update' })
  .inputSchema(updateReading)
  .action(async ({ parsedInput: { id, ...fields }, ctx }) => {
    const before = getReading(id)
    if (!before) throw new ActionError('找不到這筆紀錄，可能已經被刪除')
    if (before.eventId !== null) {
      // 走錯路由了。這筆的日期由更換事件擁有，只能改數值
      throw new ActionError('這筆紀錄來自更換紀錄，日期要到那筆更換紀錄去改')
    }

    const after = db
      .update(readings)
      .set({ ...fields, updatedAt: Date.now() })
      .where(eq(readings.id, id))
      .returning()
      .get()

    ctx.audit({
      entity: 'reading',
      entityId: id,
      summary: `修改 ${after.measuredOn} 的水質紀錄：原水 ${after.rawPpm} / 純水 ${after.purePpm} ppm`,
      before,
      after,
    })
    refresh()
    return { id, measuredOn: after.measuredOn }
  })

/**
 * 更換紀錄擁有的那筆 PPM：**只改數值，不動日期**。
 *
 * 這是刻意分成兩個 action 而不是在一個 action 裡用旗標分支 ——
 * 分支會讓「日期到底改不改」取決於客戶端送了什麼欄位，
 * 而客戶端是不可信的。分成兩個 schema，能改的欄位就是型別的一部分。
 */
export const editEventReading = authedAction
  .metadata({ name: 'reading.update' })
  .inputSchema(updateEventReading)
  .action(async ({ parsedInput: { id, ...fields }, ctx }) => {
    const before = getReading(id)
    if (!before) throw new ActionError('找不到這筆紀錄，可能已經被刪除')
    if (before.eventId === null) {
      throw new ActionError('這筆紀錄不是來自更換紀錄')
    }

    const after = db
      .update(readings)
      .set({ ...fields, updatedAt: Date.now() })
      .where(eq(readings.id, id))
      .returning()
      .get()

    ctx.audit({
      entity: 'reading',
      entityId: id,
      summary: `修改更換當日（${after.measuredOn}）的水質：原水 ${after.rawPpm} / 純水 ${after.purePpm} ppm`,
      before,
      after,
    })
    refresh()
    return { id, measuredOn: after.measuredOn }
  })

export const removeReading = authedAction
  .metadata({ name: 'reading.delete' })
  .inputSchema(readingRef)
  .action(async ({ parsedInput: { id }, ctx }) => {
    const before = getReading(id)
    if (!before) throw new ActionError('找不到這筆紀錄，可能已經被刪除')

    /*
     * 事件擁有的紀錄不可單獨刪除。
     *
     * 允許的話會出現一筆「有 PPM 欄位但查不到 PPM」的更換紀錄 ——
     * 資料本身沒有壞，但使用者會以為當天忘記量了。
     * 要刪就整筆更換紀錄一起刪，cascade 會把這筆帶走。
     */
    if (before.eventId !== null) {
      throw new ActionError(
        '這筆水質紀錄屬於一筆更換紀錄，不能單獨刪除。' +
          '若要移除，請到耗材紀錄刪除那筆更換 —— 這筆會一併消失。',
      )
    }

    db.delete(readings).where(eq(readings.id, id)).run()

    ctx.audit({
      entity: 'reading',
      entityId: id,
      summary: `刪除 ${before.measuredOn} 的水質紀錄`,
      before,
    })
    refresh()
    return { measuredOn: before.measuredOn }
  })
