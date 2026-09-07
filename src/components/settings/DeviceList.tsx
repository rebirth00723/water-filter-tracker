'use client'

import { ChevronRight, Plus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useAction } from 'next-safe-action/hooks'
import { toast } from 'sonner'
import { sortDevices } from '@/app/(app)/settings/devices/actions'
import { actionErrorMessage } from '@/components/forms/action-feedback'
import { DeviceForm } from '@/components/forms/DeviceForm'
import { Badge, Button, Card, EmptyState, Row } from '@/components/ui'
import { Drawer } from '@/components/ui/Drawer'
import type { Device } from '@/lib/devices'
import { ReorderButtons } from './ReorderButtons'

export function DeviceList({ devices }: { devices: Device[] }) {
  const [creating, setCreating] = useState(false)

  const reorder = useAction(sortDevices, {
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">設備</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            每台飲水機一筆。點進去設定它的種類與耗材、下載專屬 QR Code
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          新增
        </Button>
      </div>

      {devices.length === 0 ? (
        <EmptyState
          title="還沒有任何設備"
          description="其他所有頁面都掛在設備底下，所以這是第一步。"
          action={<Button onClick={() => setCreating(true)}>新增第一台設備</Button>}
        />
      ) : (
        <Card>
          {devices.map((d, i) => (
            <Row key={d.id} className="pr-2">
              <Link
                href={`/settings/devices/${d.id}`}
                className="flex min-w-0 flex-1 items-center gap-2 py-1"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{d.name}</span>
                    {!d.active && <Badge tone="muted">停用</Badge>}
                  </span>
                  {d.model && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {d.model}
                    </span>
                  )}
                </span>
              </Link>

              {devices.length > 1 && (
                <ReorderButtons
                  index={i}
                  total={devices.length}
                  pending={reorder.isPending}
                  onMove={(from, to) => {
                    const ids = devices.map((x) => x.id)
                    const [moved] = ids.splice(from, 1)
                    ids.splice(to, 0, moved)
                    reorder.execute({ ids })
                  }}
                />
              )}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Row>
          ))}
        </Card>
      )}

      <Drawer open={creating} onOpenChange={setCreating} title="新增設備">
        <DeviceForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
      </Drawer>
    </section>
  )
}
