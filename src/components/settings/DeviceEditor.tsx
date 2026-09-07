'use client'

import { DeviceForm } from '@/components/forms/DeviceForm'
import { Card } from '@/components/ui'
import type { Device } from '@/lib/devices'

/** 設備基本資料。在詳細頁裡直接內嵌而不開抽屜 —— 這一頁本來就是為了改它而存在 */
export function DeviceEditor({ device }: { device: Device }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">基本資料</h2>
      <Card className="px-4 pt-1 pb-0">
        <DeviceForm device={device} />
      </Card>
    </section>
  )
}
