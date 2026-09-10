import * as echarts from 'echarts'
import { describe, expect, it } from 'vitest'
import type { ReportData } from '@/lib/report-store'
import { buildOption } from './PpmChart'
import type { ChartColors } from './useChartColors'

/*
 * 這張圖的正確性是**幾何**的，不是資料的。
 *
 * `toTs()` 把 `YYYY-MM-DD` 轉成 UTC 午夜，而 ECharts 的 `time` 軸預設
 * 用瀏覽器本地時區決定刻度落點。少了 `useUTC: true`，資料點與標著同一天的
 * 刻度就會差一個時區偏移（台北 8 小時、紐約 4 小時），
 * 於是「換濾心那天 PPM 掉下來」會被讀成前一天或後一天。
 *
 * 所以這裡不檢查 option 裡有沒有那個欄位 —— 檢查欄位只會證明字串還在。
 * 這裡把 option 交給真的 ECharts 去算像素，量資料點與刻度的距離。
 */

const toTs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)

const COLORS: ChartColors = {
  raw: '#f97316',
  pure: '#2563eb',
  text: '#000',
  grid: '#eee',
  danger: '#dc2626',
}

function fixture(): ReportData {
  return {
    readings: [
      [toTs('2026-09-14'), 300, 20],
      [toTs('2026-09-15'), 305, 8],
      [toTs('2026-09-16'), 310, 9],
    ],
    lanes: [
      {
        categoryId: 1,
        name: '第一道',
        color: '#3b82f6',
        points: [{ ts: toTs('2026-09-15'), label: 'PP 棉×1' }],
        dueTs: null,
        dueOn: null,
        overdue: false,
      },
    ],
    range: { fromTs: toTs('2026-09-14'), toTs: toTs('2026-09-16') },
  } as ReportData
}

/** 渲染一次，回傳 SVG 字串 */
function render(): string {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 700, height: 400 })
  const data = fixture()
  chart.setOption(buildOption(data, data.lanes, COLORS))
  const svg = chart.renderToSVGString()
  chart.dispose()
  return svg
}

/** 找出寫著 `text` 的軸標籤的 x 座標 */
function tickX(svg: string, text: string): number | null {
  for (const m of svg.matchAll(/<text[^>]*transform="translate\(([\d.]+) [\d.]+\)"[^>]*>([^<]*)<\/text>/g)) {
    if (m[2] === text) return Number(m[1])
  }
  return null
}

/** 泳道上那顆更換點的 x 座標（scatter 用 matrix 定位） */
function scatterX(svg: string): number | null {
  const xs = [...svg.matchAll(/matrix\([\d.]+,0,0,[\d.]+,([\d.]+),([\d.]+)\)/g)].map((m) => Number(m[1]))
  return xs.length ? xs[0] : null
}

describe('PpmChart 的時間軸', () => {
  // 每個時區都跑一次：bug 在 UTC 下不會出現，只在 UTC 才過的測試等於沒測
  for (const tz of ['UTC', 'Asia/Taipei', 'America/New_York', 'Pacific/Kiritimati']) {
    it(`在 ${tz} 下，9/15 的更換點對齊標著 15 的刻度`, () => {
      const original = process.env.TZ
      process.env.TZ = tz
      try {
        const svg = render()
        const pt = scatterX(svg)
        const tick = tickX(svg, '15')
        expect(pt, '找不到更換點').not.toBeNull()
        expect(tick, '找不到標著 15 的刻度').not.toBeNull()
        // 1px 容差：ECharts 對刻度線做半像素對齊
        expect(Math.abs((tick as number) - (pt as number))).toBeLessThan(1)
      } finally {
        if (original === undefined) delete process.env.TZ
        else process.env.TZ = original
      }
    })
  }

  it('兩個 x 軸共用同一組 min/max（對齊是幾何保證，不是目測）', () => {
    const data = fixture()
    const opt = buildOption(data, data.lanes, COLORS) as {
      xAxis: { min: number; max: number }[]
    }
    expect(opt.xAxis).toHaveLength(2)
    expect(opt.xAxis[0].min).toBe(opt.xAxis[1].min)
    expect(opt.xAxis[0].max).toBe(opt.xAxis[1].max)
  })
})
