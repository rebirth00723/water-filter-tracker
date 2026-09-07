'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { NAV_ITEMS, isNavActive, navDeviceId, navHref } from './nav-items'

export function BottomTabBar({ fallbackDeviceId }: { fallbackDeviceId: number | null }) {
  const pathname = usePathname()
  const deviceId = navDeviceId(pathname, fallbackDeviceId)

  return (
    <nav
      aria-label="主導覽"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border
                 bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(pathname, item)
        const { label, Icon } = item
        return (
          <Link
            key={label}
            href={navHref(item, deviceId)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="size-5" aria-hidden strokeWidth={active ? 2.4 : 1.8} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
