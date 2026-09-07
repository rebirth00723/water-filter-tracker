import { db } from './db'
import { auditLog } from './db/schema'
import { log } from './log'

export interface AuditEntry {
  username?: string | null
  ip?: string | null
  userAgent?: string | null
  action: string
  entity?: string | null
  entityId?: number | null
  summary: string
  before?: unknown
  after?: unknown
}

/**
 * 操作紀錄。與 stdout 的結構化日誌並行 ——
 * log 用來排查、audit_log 用來回答「誰在何時把哪一筆改成什麼」，
 * 並保留變更前後值，讓誤刪的紀錄可以照著補回。
 */
export function audit(entry: AuditEntry): void {
  try {
    db.insert(auditLog)
      .values({
        username: entry.username ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        action: entry.action,
        entity: entry.entity ?? null,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        beforeJson: entry.before === undefined ? null : JSON.stringify(entry.before),
        afterJson: entry.after === undefined ? null : JSON.stringify(entry.after),
      })
      .run()
  } catch (err) {
    // 稽核寫入失敗絕不能讓主要操作跟著失敗
    log.error('寫入操作紀錄失敗', { err, action: entry.action })
  }

  log.info(entry.summary, {
    action: entry.action,
    user: entry.username ?? undefined,
    ip: entry.ip ?? undefined,
    entity: entry.entity ?? undefined,
    entityId: entry.entityId ?? undefined,
  })
}
