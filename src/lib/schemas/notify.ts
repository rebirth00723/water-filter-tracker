import { z } from 'zod'
import { NOTIFY_RULE_KINDS } from '@/lib/db/schema'
import { dbId, optionalText, positiveInt } from './common'

/** HH:MM。留空＝沿用全域預設 */
export const optionalTime = z
  .union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '請用 HH:MM 格式')])
  .transform((v) => (v === '' ? null : v))

const ruleShape = {
  kind: z.enum(NOTIFY_RULE_KINDS),
  /** ADVANCE：提前幾天。0＝當天 */
  offsetDays: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : Number(v)))
    .refine((v) => v === null || Number.isInteger(v), '天數必須是整數')
    .refine((v) => v === null || (v >= 0 && v <= 365), '天數需在 0–365 之間'),
  /** OVERDUE：逾期後每幾天重發一次 */
  repeatDays: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : Number(v)))
    .refine((v) => v === null || Number.isInteger(v), '天數必須是整數')
    .refine((v) => v === null || (v >= 1 && v <= 365), '重發間隔需在 1–365 天之間'),
  template: z.string().trim().min(1, '請填寫訊息內容').max(400, '訊息不能超過 400 字'),
  priority: z.coerce.number().int().min(1, '優先度為 1–5').max(5, '優先度為 1–5'),
  sendTime: optionalTime,
  enabled: z.boolean(),
}

/**
 * ADVANCE 需要 offsetDays、OVERDUE 需要 repeatDays ——
 * 兩者是互斥的，而 UI 會依 kind 只顯示其中一個。
 * 伺服端仍要驗，因為客戶端可能送來兩個都空的組合，
 * 那會產生一條「不知道什麼時候該送」的規則，然後永遠不送或每天送。
 */
const requiredFieldForKind = (
  v: { kind: 'ADVANCE' | 'OVERDUE'; offsetDays: number | null; repeatDays: number | null },
  ctx: z.RefinementCtx,
) => {
  if (v.kind === 'ADVANCE' && v.offsetDays === null) {
    ctx.addIssue({ code: 'custom', path: ['offsetDays'], message: '提前提醒需要填天數（0＝當天）' })
  }
  if (v.kind === 'OVERDUE' && v.repeatDays === null) {
    ctx.addIssue({ code: 'custom', path: ['repeatDays'], message: '逾期提醒需要填重發間隔' })
  }
}

export const notifyRuleFormSchema = z.object(ruleShape).superRefine(requiredFieldForKind)
export const createNotifyRule = z.object(ruleShape).superRefine(requiredFieldForKind)
export const updateNotifyRule = z
  .object({ ...ruleShape, id: dbId })
  .superRefine(requiredFieldForKind)
export const notifyRuleRef = z.object({ id: dbId })

/** 全域偏好 */
export const notifyPrefs = z.object({
  sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '請用 HH:MM 格式'),
  catchupMaxDays: positiveInt(365, '補送上限'),
  auditKeepDays: positiveInt(3650, '稽核紀錄保留天數'),
})

/** 管理中心的 ntfy 連線設定 */
export const ntfyConfigSchema = z.object({
  url: optionalText(200),
  topicFilter: optionalText(64),
  topicSecurity: optionalText(64),
  /** 留空＝不變更（不回顯已存的值） */
  token: optionalText(200),
  user: optionalText(80),
  password: optionalText(200),
  /** 明確清除認證 */
  clearAuth: z.boolean().default(false),
})

export const testNotifySchema = z.object({
  channel: z.enum(['filter', 'security']),
})

export type NotifyRuleFormValues = z.input<typeof notifyRuleFormSchema>
