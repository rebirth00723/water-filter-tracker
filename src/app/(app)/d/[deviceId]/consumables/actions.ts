'use server'

import { refresh } from 'next/cache'
import { fmtZh } from '@/lib/date'
import { getDevice } from '@/lib/devices'
import {
  createEventTx,
  deleteEventTx,
  getEvent,
  updateEventTx,
  type EventWriteInput,
} from '@/lib/events-store'
import { ActionError, authedAction } from '@/lib/safe-action'
import { createEvent, eventRef, updateEvent } from '@/lib/schemas/events'

/**
 * 把 zod 的輸出攤平成 store 要的形狀。
 *
 * PURCHASE 分支根本沒有 rawPpm/purePpm 欄位（那是 discriminatedUnion 的重點），
 * 所以這裡要補成 null —— 用 `in` 檢查而不是可選存取，因為前者是型別收窄，
 * 後者只是執行期碰運氣。
 */
function toWriteInput(
  parsed:
    | { type: 'PURCHASE'; occurredOn: string; vendor: string | null; note: string | null; lines: EventWriteInput['lines'] }
    | { type: 'REPLACE'; occurredOn: string; note: string | null; rawPpm: number | null; purePpm: number | null; lines: EventWriteInput['lines'] },
): EventWriteInput {
  if (parsed.type === 'PURCHASE') {
    return { ...parsed, rawPpm: null, purePpm: null }
  }
  return { ...parsed, vendor: null }
}

/** 稽核摘要用的一句話 */
function describe(input: EventWriteInput): string {
  const total = input.lines.reduce((s, l) => s + l.qty, 0)
  return `${input.lines.length} 項耗材（共 ${total} 個）`
}

export const addEvent = authedAction
  .metadata({ name: 'event.create' })
  .inputSchema(createEvent)
  .action(async ({ parsedInput, ctx }) => {
    const { deviceId, ...rest } = parsedInput
    const device = getDevice(deviceId)
    if (!device) throw new ActionError('找不到這台設備，可能已經被刪除')

    const input = toWriteInput(rest)
    const id = createEventTx(deviceId, input)

    ctx.audit({
      entity: 'event',
      entityId: id,
      summary:
        `在「${device.name}」新增${input.type === 'REPLACE' ? '更換' : '新購'}紀錄 ` +
        `${fmtZh(input.occurredOn)}：${describe(input)}` +
        (input.rawPpm !== null ? `，原水 ${input.rawPpm} / 純水 ${input.purePpm} ppm` : ''),
      after: input,
    })
    refresh()
    return { id, type: input.type, occurredOn: input.occurredOn, lineCount: input.lines.length }
  })

export const editEvent = authedAction
  .metadata({ name: 'event.update' })
  .inputSchema(updateEvent)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    const before = getEvent(id)
    if (!before) throw new ActionError('找不到這筆紀錄，可能已經被刪除')

    const input = toWriteInput(rest)
    updateEventTx(id, input)

    ctx.audit({
      entity: 'event',
      entityId: id,
      summary: `修改 ${fmtZh(before.occurredOn)} 的紀錄（改為 ${fmtZh(input.occurredOn)}：${describe(input)}）`,
      before,
      after: input,
    })
    refresh()
    return { id, type: input.type, occurredOn: input.occurredOn }
  })

export const removeEvent = authedAction
  .metadata({ name: 'event.delete' })
  .inputSchema(eventRef)
  .action(async ({ parsedInput: { id }, ctx }) => {
    const before = getEvent(id)
    if (!before) throw new ActionError('找不到這筆紀錄，可能已經被刪除')

    deleteEventTx(id)

    ctx.audit({
      entity: 'event',
      entityId: id,
      summary:
        `刪除 ${fmtZh(before.occurredOn)} 的${before.type === 'REPLACE' ? '更換' : '新購'}紀錄` +
        (before.reading ? '，連帶刪除當天的水質紀錄' : ''),
      before,
    })
    refresh()
    return { occurredOn: before.occurredOn, hadReading: before.reading !== null }
  })
