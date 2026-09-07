'use client'

import { Check, ChevronsUpDown } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'
import { Drawer } from '@/components/ui/Drawer'
import { swapDeviceInPath } from '@/lib/device-path'
import { cn } from '@/lib/utils'

export interface SwitcherDevice {
  id: number
  name: string
  model: string | null
}

/**
 * 設備切換器。
 *
 * 只在有兩台以上時渲染 —— 單一設備的使用者根本不該看到這個控制項，
 * 它只會讓畫面多一個永遠不需要按的東西。
 *
 * 切換時**停在同一個分頁**而不是跳回首頁：比較兩台設備的水質時，
 * 每按一次就被丟回首頁會讓這個功能實際上不能用。
 */
export function DeviceSwitcher({
  devices,
  currentId,
}: {
  devices: SwitcherDevice[]
  currentId: number
}) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  if (devices.length < 2) return null
  const current = devices.find((d) => d.id === currentId)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-9 max-w-[52vw] items-center gap-1.5 rounded-md border border-input
                   bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2
                   focus-visible:ring-ring md:max-w-none"
      >
        <span className="truncate">{current?.name ?? '選擇設備'}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      <Drawer open={open} onOpenChange={setOpen} title="切換設備" description="會停在目前這個分頁">
        <ul className="pb-2">
          {devices.map((d) => {
            const selected = d.id === currentId
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    if (!selected) router.push(swapDeviceInPath(pathname, d.id))
                  }}
                  className={cn(
                    'flex min-h-14 w-full items-center gap-3 border-b border-border px-1 text-left last:border-b-0',
                    selected && 'font-medium',
                  )}
                >
                  <Check
                    className={cn('size-4 shrink-0', selected ? 'text-primary' : 'opacity-0')}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{d.name}</span>
                    {d.model && (
                      <span className="block truncate text-xs text-muted-foreground">{d.model}</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Drawer>
    </>
  )
}
