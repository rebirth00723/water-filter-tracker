import 'server-only'
import { and, asc, eq, lt, sql } from 'drizzle-orm'
import { audit } from '../audit'
import { getPublicUrl } from '../config'
import { addDays, diffDays, currentHour, currentDate } from '../date'
import { db } from '../db'
import { categories, devices, items, notifyLog, notifyRules } from '../db/schema'
import { devicePath } from '../device-path'
import { categoryDues, type CategoryDue } from '../events-store'
import { log } from '../log'
import { getSetting } from '../settings'
import { NtfyError, ntfyConfigured, sendNtfy } from './ntfy'
import { renderTemplate } from './template'

/**
 * 到期掃描。
 *
 * **設計重點：這是「掃描」而不是「定時觸發」。**
 * croner 每 15 分鐘跑一次，而「今天幾點之後才送」是掃描裡的一個條件。
 * 反過來做（每天在設定的時刻觸發一次）的話，機器剛好在那個時刻沒開機
 * 就整天不送；而現在下午開機，下一個 tick 就會補上。
 *
 * 發送時刻存在的理由是**日期在午夜換掉** —— 觸發日一到，那天的第一次掃描
 * 就會判定該送，手機會在半夜零點多響。設了時刻之後，還沒到就跳過，
 * 等到該鐘點的那次掃描才真的送出。重開機只是同一件事的其中一個實例，不是主因。
 */

export interface SweepResult {
  scanned: number
  sent: number
  failed: number
  skipped: number
  retried: number
  /** 沒送的原因，給手動觸發時顯示 */
  notes: string[]
}

const MAX_ATTEMPTS = 5

/** 逐條規則的發送時刻 → 小時。留空沿用全域預設 */
function sendHour(ruleSendTime: string | null): number {
  const raw = ruleSendTime?.trim() || getSetting('notify.sendTime', '09:00')
  const h = Number(raw.split(':')[0])
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 9
}

/** 該種類底下啟用中的耗材，用於樣板的 {items} */
function itemsLabel(categoryId: number): string {
  return db
    .select({ name: items.name, qty: items.defaultQty })
    .from(items)
    .where(and(eq(items.categoryId, categoryId), eq(items.active, true)))
    .orderBy(asc(items.name))
    .all()
    .map((i) => (i.qty > 1 ? `${i.name}×${i.qty}` : i.name))
    .join(' ')
}

/** 該設備的濾心提醒 topic（設備專屬優先） */
function topicFor(deviceNtfyTopic: string | null): string | undefined {
  return deviceNtfyTopic?.trim() || undefined
}

function clickUrl(deviceId: number): string | undefined {
  const base = getPublicUrl()
  return base ? `${base}${devicePath(deviceId, 'consumables')}` : undefined
}

/**
 * 主掃描。
 *
 * `force` 用於管理中心的手動觸發：跳過「發送時刻還沒到」這個條件，
 * 但**不跳過去重** —— 手動按三次不該送出三則一樣的通知。
 */
export async function sweep(opts: { force?: boolean; now?: Date } = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date()
  const today = currentDate(now)
  const hour = currentHour(now)
  const result: SweepResult = { scanned: 0, sent: 0, failed: 0, skipped: 0, retried: 0, notes: [] }

  if (!ntfyConfigured('filter')) {
    result.notes.push('尚未設定 ntfy 伺服器或濾心提醒 topic，通知已停用（App 其餘功能不受影響）')
    return result
  }

  const catchupMax = Number(getSetting('notify.catchupMaxDays', '14')) || 14
  const rules = db.select().from(notifyRules).where(eq(notifyRules.enabled, true)).all()
  if (rules.length === 0) {
    result.notes.push('沒有啟用中的通知規則')
    return result
  }

  // 先撿回上次失敗的 —— 放在前面是因為它們比新的通知更該優先送出
  result.retried = await retryFailed(result)

  const activeDevices = db.select().from(devices).where(eq(devices.active, true)).all()

  for (const device of activeDevices) {
    const dues = categoryDues(device.id, today).filter(
      (d) => d.active && d.notifyEnabled && d.due.dueOn !== null,
    )
    result.scanned += dues.length

    /** 超過補送上限的項目，最後彙總成一則 */
    const digest: string[] = []

    for (const rule of rules) {
      for (const due of dues) {
        const plan = planFor(
          rule,
          due,
          today,
          catchupMax,
          rule.kind === 'OVERDUE' ? lastOverdueSentOn(rule.id, due.categoryId) : null,
        )
        if (plan === null) continue

        if (plan.kind === 'skip') {
          // 佔住 key，否則超齡項目每次掃描都會被重新算成「應送未送」
          const claimed = claim(rule.id, due.categoryId, plan.logDueOn, plan.logKind, 'skipped')
          if (claimed) {
            result.skipped += 1
            digest.push(`${due.name}（${plan.lateBy} 天前就該提醒）`)
          }
          continue
        }

        // 發送時刻的閘門。手動觸發可以跳過，但去重不跳過
        if (!opts.force && hour < sendHour(rule.sendTime)) continue

        const claimed = claim(rule.id, due.categoryId, plan.logDueOn, plan.logKind, 'pending')
        if (!claimed) continue // 送過了

        const message = renderTemplate(rule.template, {
          device: device.name,
          category: due.name,
          items: itemsLabel(due.categoryId),
          days: plan.days,
          dueOn: due.due.dueOn!,
        })

        await deliver({
          logId: claimed,
          message,
          title: `${device.name} · ${due.name}`,
          priority: rule.priority,
          topic: topicFor(device.ntfyTopic),
          click: clickUrl(device.id),
          tags: plan.logKind === 'overdue' ? ['warning'] : ['droplet'],
          result,
        })
      }
    }

    if (digest.length > 0) {
      await sendDigest(device.name, digest, topicFor(device.ntfyTopic), clickUrl(device.id), result)
    }
  }

  if (result.sent === 0 && result.notes.length === 0) {
    result.notes.push(
      `掃描了 ${result.scanned} 個到期項目，沒有需要送出的通知` +
        (opts.force ? '（已送過的不會重複送）' : `（目前 ${hour} 點，可能還沒到發送時刻）`),
    )
  }
  return result
}

type Plan =
  | { kind: 'send'; logDueOn: string; logKind: 'advance' | 'overdue'; days: number; lateBy: number }
  | { kind: 'skip'; logDueOn: string; logKind: 'advance'; lateBy: number }

/**
 * 這條規則對這個種類今天該做什麼。null＝什麼都不做。
 *
 * 抽成純函式的理由是它是整個掃描裡唯一有分支的邏輯，
 * 而分支錯了的症狀是「通知沒來」或「通知一直來」，兩者都很難事後追。
 */
export function planFor(
  rule: { kind: 'ADVANCE' | 'OVERDUE'; offsetDays: number | null; repeatDays: number | null; id: number },
  due: Pick<CategoryDue, 'categoryId' | 'due'>,
  today: string,
  catchupMax: number,
  lastOverdueSentOn?: string | null,
): Plan | null {
  const dueOn = due.due.dueOn
  if (dueOn === null) return null

  if (rule.kind === 'ADVANCE') {
    const offset = rule.offsetDays ?? 0
    const triggerOn = addDays(dueOn, -offset)
    const lateBy = diffDays(today, triggerOn)
    if (lateBy < 0) return null // 還沒到觸發日

    if (lateBy > catchupMax) {
      // 關機太久才到期的項目不逐一補送，改發一則彙總
      return { kind: 'skip', logDueOn: dueOn, logKind: 'advance', lateBy }
    }
    // days 一律是正數：ADVANCE 是剩餘天數
    return {
      kind: 'send',
      logDueOn: dueOn,
      logKind: 'advance',
      days: Math.max(0, diffDays(dueOn, today)),
      lateBy,
    }
  }

  // OVERDUE
  if (!due.due.overdue) return null
  const daysOverdue = Math.abs(due.due.daysLeft!)
  const repeat = rule.repeatDays ?? 7

  /*
   * 頻率用「距上次送出幾天」而不是 `daysOverdue % repeat === 0`。
   * 後者在機器剛好那一天沒開機時就永遠跳過那一輪 ——
   * 而逾期提醒正是最不該漏掉的一種。
   */
  if (lastOverdueSentOn && diffDays(today, lastOverdueSentOn) < repeat) return null

  return { kind: 'send', logDueOn: today, logKind: 'overdue', days: daysOverdue, lateBy: 0 }
}

/**
 * 這條逾期規則上次真的送出是哪一天。
 *
 * 逾期通知的 `dueOn` 存的是**送出當日**（讓每一次重複各佔一列），
 * 所以取最大的那個 dueOn 就是上次送出的日期。
 */
function lastOverdueSentOn(ruleId: number, categoryId: number): string | null {
  const row = db
    .select({ last: sql<string | null>`max(${notifyLog.dueOn})` })
    .from(notifyLog)
    .where(
      and(
        eq(notifyLog.ruleId, ruleId),
        eq(notifyLog.categoryId, categoryId),
        eq(notifyLog.kind, 'overdue'),
        eq(notifyLog.status, 'sent'),
      ),
    )
    .get()
  return row?.last ?? null
}

/**
 * 先佔位再送出（outbox）。
 *
 * `INSERT OR IGNORE` 影響列數為 0 就代表送過了 —— **不要先 SELECT 再 INSERT**，
 * 那是 TOCTOU：兩次掃描重疊時兩邊都會讀到「還沒送」然後各送一次。
 */
function claim(
  ruleId: number,
  categoryId: number,
  dueOn: string,
  kind: string,
  status: 'pending' | 'skipped',
): number | null {
  const rows = db
    .insert(notifyLog)
    .values({ ruleId, categoryId, target: '', dueOn, kind, status })
    .onConflictDoNothing()
    .returning({ id: notifyLog.id })
    .all()
  return rows[0]?.id ?? null
}

async function deliver(args: {
  logId: number
  message: string
  title: string
  priority: number
  topic?: string
  click?: string
  tags: string[]
  result: SweepResult
}) {
  try {
    const res = await sendNtfy({
      channel: 'filter',
      topic: args.topic,
      title: args.title,
      message: args.message,
      priority: args.priority as 1 | 2 | 3 | 4 | 5,
      tags: args.tags,
      click: args.click,
    })
    db.update(notifyLog)
      .set({
        status: 'sent',
        target: res.topic,
        sentAt: Date.now(),
        attempts: sql`${notifyLog.attempts} + 1`,
        lastError: null,
      })
      .where(eq(notifyLog.id, args.logId))
      .run()
    args.result.sent += 1
  } catch (err) {
    const msg = err instanceof NtfyError ? err.message : (err as Error).message
    db.update(notifyLog)
      .set({
        status: 'failed',
        attempts: sql`${notifyLog.attempts} + 1`,
        lastError: msg.slice(0, 500),
      })
      .where(eq(notifyLog.id, args.logId))
      .run()
    args.result.failed += 1
    args.result.notes.push(`送出失敗：${msg}`)
    // 送不出去的通知不會再用推播告知（推播本身就是壞掉的那一環），
    // 留在 notify_log 並在設定頁標紅
    log.warn('通知送出失敗', { err, logId: args.logId })
  }
}

/** 撿回上次失敗的。超過 5 次就停止並留在設定頁標紅 */
async function retryFailed(result: SweepResult): Promise<number> {
  const pending = db
    .select({
      id: notifyLog.id,
      ruleId: notifyLog.ruleId,
      categoryId: notifyLog.categoryId,
      dueOn: notifyLog.dueOn,
      kind: notifyLog.kind,
      attempts: notifyLog.attempts,
    })
    .from(notifyLog)
    .where(and(eq(notifyLog.status, 'failed'), lt(notifyLog.attempts, MAX_ATTEMPTS)))
    .limit(20)
    .all()
  if (pending.length === 0) return 0

  for (const row of pending) {
    const rule = db.select().from(notifyRules).where(eq(notifyRules.id, row.ruleId)).get()
    const cat = db.select().from(categories).where(eq(categories.id, row.categoryId)).get()
    if (!rule || !cat) {
      // 規則或種類被刪了，這筆重試沒有意義
      db.update(notifyLog)
        .set({ status: 'skipped', lastError: '規則或種類已被刪除' })
        .where(eq(notifyLog.id, row.id))
        .run()
      continue
    }
    const device = db.select().from(devices).where(eq(devices.id, cat.deviceId)).get()
    if (!device) continue

    const dues = categoryDues(cat.deviceId, currentDate())
    const due = dues.find((d) => d.categoryId === cat.id)
    if (!due?.due.dueOn) continue

    await deliver({
      logId: row.id,
      message: renderTemplate(rule.template, {
        device: device.name,
        category: cat.name,
        items: itemsLabel(cat.id),
        days: Math.abs(due.due.daysLeft ?? 0),
        dueOn: due.due.dueOn,
      }),
      title: `${device.name} · ${cat.name}`,
      priority: rule.priority,
      topic: topicFor(device.ntfyTopic),
      click: clickUrl(device.id),
      tags: row.kind === 'overdue' ? ['warning'] : ['droplet'],
      result,
    })
  }
  return pending.length
}

async function sendDigest(
  deviceName: string,
  lines: string[],
  topic: string | undefined,
  click: string | undefined,
  result: SweepResult,
) {
  try {
    const res = await sendNtfy({
      channel: 'filter',
      topic,
      title: `${deviceName} · ${lines.length} 項逾期已久`,
      message:
        `以下項目超過補送上限，只發這一則彙總：\n${lines.join('\n')}\n\n` +
        `（機器可能有一段時間沒開機）`,
      priority: 4,
      tags: ['warning'],
      click,
    })
    log.info('已送出離線彙總', { topic: res.topic, count: lines.length })
    result.sent += 1
  } catch (err) {
    log.warn('離線彙總送出失敗', { err })
    result.notes.push(`彙總送出失敗：${(err as Error).message}`)
  }
}

/** 每日清理：稽核紀錄依保留天數刪除。與掃描一起跑，不另開排程 */
export function pruneAuditLog(): number {
  const keepDays = Number(getSetting('audit.keepDays', '180')) || 180
  const cutoff = Date.now() - keepDays * 86_400_000
  const res = db.run(sql`delete from audit_log where at < ${cutoff}`)
  return res.changes
}

/** 未讀的失敗通知，設定頁用來標紅 */
export function failedNotifications(): {
  id: number
  dueOn: string
  kind: string
  attempts: number
  lastError: string | null
  categoryName: string | null
}[] {
  return db
    .select({
      id: notifyLog.id,
      dueOn: notifyLog.dueOn,
      kind: notifyLog.kind,
      attempts: notifyLog.attempts,
      lastError: notifyLog.lastError,
      categoryName: categories.name,
    })
    .from(notifyLog)
    .leftJoin(categories, eq(notifyLog.categoryId, categories.id))
    .where(eq(notifyLog.status, 'failed'))
    .orderBy(asc(notifyLog.claimedAt))
    .limit(50)
    .all()
}

/** 手動觸發（管理中心）。會寫稽核紀錄，因為它會真的送出通知 */
export async function manualSweep(username: string): Promise<SweepResult> {
  const res = await sweep({ force: true })
  audit({
    action: 'notify.manual',
    username,
    summary:
      `手動觸發通知掃描：掃了 ${res.scanned} 項，送出 ${res.sent} 則` +
      (res.failed ? `，失敗 ${res.failed} 則` : ''),
    after: res,
  })
  return res
}
