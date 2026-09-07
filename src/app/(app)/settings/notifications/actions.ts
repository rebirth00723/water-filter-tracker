'use server'

import { eq } from 'drizzle-orm'
import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { notifyRules } from '@/lib/db/schema'
import { SETTING_KEYS, setSetting } from '@/lib/settings'
import { ActionError, authedAction } from '@/lib/safe-action'
import {
  createNotifyRule,
  notifyPrefs,
  notifyRuleRef,
  updateNotifyRule,
} from '@/lib/schemas/notify'

function kindLabel(kind: 'ADVANCE' | 'OVERDUE') {
  return kind === 'ADVANCE' ? '提前提醒' : '逾期提醒'
}

/** 只保留該 kind 用得到的欄位。另一個設成 null，避免留下看不懂的殘值 */
function normalize(v: {
  kind: 'ADVANCE' | 'OVERDUE'
  offsetDays: number | null
  repeatDays: number | null
}) {
  return v.kind === 'ADVANCE'
    ? { offsetDays: v.offsetDays, repeatDays: null }
    : { offsetDays: null, repeatDays: v.repeatDays }
}

export const addNotifyRule = authedAction
  .metadata({ name: 'notifyRule.create' })
  .inputSchema(createNotifyRule)
  .action(async ({ parsedInput, ctx }) => {
    const row = db
      .insert(notifyRules)
      .values({ ...parsedInput, ...normalize(parsedInput) })
      .returning()
      .get()
    ctx.audit({
      entity: 'notifyRule',
      entityId: row.id,
      summary: `新增${kindLabel(row.kind)}規則`,
      after: row,
    })
    refresh()
    return { id: row.id, kind: row.kind }
  })

export const editNotifyRule = authedAction
  .metadata({ name: 'notifyRule.update' })
  .inputSchema(updateNotifyRule)
  .action(async ({ parsedInput: { id, ...fields }, ctx }) => {
    const before = db.select().from(notifyRules).where(eq(notifyRules.id, id)).get()
    if (!before) throw new ActionError('找不到這條規則，可能已經被刪除')

    const after = db
      .update(notifyRules)
      .set({ ...fields, ...normalize(fields) })
      .where(eq(notifyRules.id, id))
      .returning()
      .get()
    ctx.audit({
      entity: 'notifyRule',
      entityId: id,
      summary: `修改${kindLabel(after.kind)}規則`,
      before,
      after,
    })
    refresh()
    return { id, kind: after.kind }
  })

export const removeNotifyRule = authedAction
  .metadata({ name: 'notifyRule.delete' })
  .inputSchema(notifyRuleRef)
  .action(async ({ parsedInput: { id }, ctx }) => {
    const before = db.select().from(notifyRules).where(eq(notifyRules.id, id)).get()
    if (!before) throw new ActionError('找不到這條規則，可能已經被刪除')

    /*
     * notify_log.rule_id 是 cascade，所以刪規則會帶走它的送出紀錄。
     * 那是刻意的：留著一堆指向已刪規則的紀錄只會讓設定頁的「失敗」清單
     * 出現無法重試也無法理解的項目。
     */
    db.delete(notifyRules).where(eq(notifyRules.id, id)).run()
    ctx.audit({
      entity: 'notifyRule',
      entityId: id,
      summary: `刪除${kindLabel(before.kind)}規則，連帶清除它的送出紀錄`,
      before,
    })
    refresh()
    return { kind: before.kind }
  })

export const saveNotifyPrefs = authedAction
  .metadata({ name: 'notifyPrefs.update' })
  .inputSchema(notifyPrefs)
  .action(async ({ parsedInput, ctx }) => {
    setSetting(SETTING_KEYS.notifySendTime, parsedInput.sendTime)
    setSetting(SETTING_KEYS.notifyCatchupMaxDays, String(parsedInput.catchupMaxDays))
    setSetting(SETTING_KEYS.auditKeepDays, String(parsedInput.auditKeepDays))

    ctx.audit({
      entity: 'settings',
      summary:
        `修改通知偏好：發送時刻 ${parsedInput.sendTime}、` +
        `補送上限 ${parsedInput.catchupMaxDays} 天、稽核保留 ${parsedInput.auditKeepDays} 天`,
      after: parsedInput,
    })
    refresh()
    return parsedInput
  })
