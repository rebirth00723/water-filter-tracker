import { DeviceHeader } from '@/components/nav/DeviceHeader'
import { ReportPanel } from '@/components/report/ReportPanel'
import { buildReport, type RangeKey } from '@/lib/report-store'

const RANGES = ['3m', '1y', 'all'] as const

function parseRange(raw: string | string[] | undefined): RangeKey {
  const v = Array.isArray(raw) ? raw[0] : raw
  // 預設 12 個月：夠看出一輪季節變化，又不會讓 X 軸擠成一團
  return (RANGES as readonly string[]).includes(v ?? '') ? (v as RangeKey) : '1y'
}

export default async function ReportPage({ params, searchParams }: PageProps<'/d/[deviceId]/report'>) {
  const id = Number((await params).deviceId)
  const range = parseRange((await searchParams).range)

  return (
    <>
      <DeviceHeader deviceId={id} title="報表" />
      <div className="px-4 py-5 md:px-8">
        <ReportPanel data={buildReport(id, range)} range={range} />
      </div>
    </>
  )
}
