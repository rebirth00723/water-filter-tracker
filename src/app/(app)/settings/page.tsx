import { Bell, ChevronRight, Database, KeyRound, ScrollText, Wrench } from 'lucide-react'
import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Card, Row, rowClass } from '@/components/ui'
import { cn } from '@/lib/utils'
import { listDevices } from '@/lib/devices'

const SECTIONS = [
  {
    href: '/settings/devices',
    label: '設備、種類與耗材',
    Icon: Wrench,
    hint: '其他頁面全部依賴這裡的設定',
    ready: true,
  },
  { href: '/settings/notifications', label: '通知規則', Icon: Bell, hint: '階段 7', ready: false },
  {
    href: '/settings/data',
    label: '匯出與匯入',
    Icon: Database,
    hint: 'JSON 單檔，可搬到另一台機器',
    ready: true,
  },
  { href: '/settings/login', label: '快速登入（passkey）', Icon: KeyRound, hint: '階段 9', ready: false },
  { href: '/settings/audit', label: '操作紀錄', Icon: ScrollText, hint: '階段 10', ready: false },
] as const

export default function SettingsPage() {
  const deviceCount = listDevices().length

  return (
    <>
      <PageHeader title="設定" />
      <div className="px-4 py-5 md:px-8">
        <Card>
          {SECTIONS.map(({ href, label, Icon, hint, ready }) => {
            const body = (
              <>
                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {href === '/settings/devices' ? `目前 ${deviceCount} 台設備` : hint}
                  </span>
                </span>
                {ready && (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
              </>
            )

            // 尚未實作的分頁不做成連結：點了跑到 404 比不能點更糟
            return ready ? (
              <Link key={href} href={href} className={cn(rowClass, 'hover:bg-muted')}>
                {body}
              </Link>
            ) : (
              <Row key={href} className="opacity-50">
                {body}
              </Row>
            )
          })}
        </Card>
      </div>
    </>
  )
}
