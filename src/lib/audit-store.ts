import 'server-only'
import { and, desc, eq, gte, like, lte, sql } from 'drizzle-orm'
import { db } from './db'
import { auditLog } from './db/schema'
import { AUDIT_GROUPS, type AuditGroup } from './audit-groups'

export type AuditRow = typeof auditLog.$inferSelect

/**
 * 操作紀錄的查詢。
 *
 * 這張表的用途是回答「誰在何時把哪一筆改成什麼」，而**含變更前後值**
 * 才是它真正的價值 —— 誤刪的紀錄可以照著 before 手動補回。
 * 只記「某人刪了某筆」的稽核紀錄在需要它的那一刻是沒有用的。
 */

export { AUDIT_GROUPS, groupOf, type AuditGroup } from './audit-groups'

export interface AuditQuery {
  group?: AuditGroup
  /** YYYY-MM-DD */
  from?: string
  to?: string
  limit: number
  offset: number
}

export function listAudit(q: AuditQuery): { rows: AuditRow[]; total: number } {
  const clauses = []

  if (q.group) {
    // 前綴比對：一個分類含多個動作名，用 OR 串起來
    const prefixes = AUDIT_GROUPS[q.group].prefixes
    clauses.push(
      sql`(${sql.join(
        prefixes.map((p) => like(auditLog.action, `${p}%`)),
        sql` or `,
      )})`,
    )
  }
  /*
   * 日期篩選比對的是 epoch ms，而使用者給的是本地日期 ——
   * 用 `>= 當天 00:00` 與 `< 隔天 00:00` 而不是 `<= 當天 23:59:59`：
   * 後者會漏掉當天最後一秒內的紀錄，而那正是「剛剛做的那件事」。
   */
  if (q.from) clauses.push(gte(auditLog.at, Date.parse(`${q.from}T00:00:00Z`)))
  if (q.to) clauses.push(lte(auditLog.at, Date.parse(`${q.to}T00:00:00Z`) + 86_400_000 - 1))

  const where = clauses.length ? and(...clauses) : undefined

  const rows = db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(q.limit)
    .offset(q.offset)
    .all()

  const total =
    db
      .select({ n: sql<number>`count(*)` })
      .from(auditLog)
      .where(where)
      .get()?.n ?? 0

  return { rows, total }
}

/** 最近一筆的時間，用於顯示「最後活動」 */
export function lastAuditAt(): number | null {
  return db.select({ at: auditLog.at }).from(auditLog).orderBy(desc(auditLog.at)).limit(1).get()?.at ?? null
}

export function auditActionCounts(): { action: string; n: number }[] {
  return db
    .select({ action: auditLog.action, n: sql<number>`count(*)` })
    .from(auditLog)
    .groupBy(auditLog.action)
    .orderBy(desc(sql`count(*)`))
    .all()
}
