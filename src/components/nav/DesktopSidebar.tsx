'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { NAV_ITEMS, isNavActive, navDeviceId, navHref } from './nav-items'

export function DesktopSidebar({ fallbackDeviceId }: { fallbackDeviceId: number | null }) {
  const pathname = usePathname()
  const deviceId = navDeviceId(pathname, fallbackDeviceId)

  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="text-lg font-semibold tracking-tight">淨水器記錄</span>
      </div>
      <nav aria-label="主導覽" className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => {
          const active = isNavActive(pathname, item)
          const { label, Icon } = item
          return (
            <Link
              key={label}
              href={navHref(item, deviceId)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-4.5" aria-hidden />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
