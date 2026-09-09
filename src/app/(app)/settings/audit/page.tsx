import { PageHeader } from '@/components/PageHeader'
import { AuditList, type AuditItem } from '@/components/settings/AuditList'
import { AUDIT_GROUPS, groupOf, type AuditGroup } from '@/lib/audit-groups'
import { fmtDateTime } from '@/lib/date'
import { listAudit } from '@/lib/audit-store'
import { SETTING_KEYS, getSetting } from '@/lib/settings'

const PAGE_SIZE = 40
const YMD = /^\d{4}-\d{2}-\d{2}$/

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function AuditPage({ searchParams }: PageProps<'/settings/audit'>) {
  const sp = await searchParams
  const rawGroup = one(sp.group)
  // 只接受已知的分類，不明的值當成「全部」而不是回 400 ——
  // 這一頁是唯讀的，寬鬆處理比報錯友善
  const group = (rawGroup && rawGroup in AUDIT_GROUPS ? rawGroup : undefined) as
    | AuditGroup
    | undefined
  const from = YMD.test(one(sp.from) ?? '') ? one(sp.from) : undefined
  const to = YMD.test(one(sp.to) ?? '') ? one(sp.to) : undefined
  const page = Math.max(1, Number(one(sp.page)) || 1)

  const { rows, total } = listAudit({
    group,
    from,
    to,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })

  const items: AuditItem[] = rows.map((r) => ({
    id: r.id,
    atLabel: fmtDateTime(r.at),
    username: r.username,
    ip: r.ip,
    userAgent: r.userAgent,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    summary: r.summary,
    before: r.beforeJson,
    after: r.afterJson,
    group: groupOf(r.action),
  }))

  return (
    <>
      <PageHeader title="操作紀錄" />
      <div className="px-4 py-5 md:px-8">
        <AuditList
          items={items}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          group={group}
          from={from}
          to={to}
          keepDays={getSetting(SETTING_KEYS.auditKeepDays, '180')}
        />
      </div>
    </>
  )
}
