'use client'

import { useMemo } from 'react'
import type { ReportData } from '@/lib/report-store'
import { useChartColors, type ChartColors } from './useChartColors'
import { useEChart, type EChartsOption } from './useEChart'

/**
 * PPM 折線 + 更換泳道，共用 X 軸。
 *
 * 用**雙 grid** 而不是雙 Y 軸：`grid[0]` 放 PPM、`grid[1]` 放泳道，
 * 兩者的 `left` / `right` 給**相同的數值**，於是 X 軸對齊是幾何保證而非目測微調。
 * 這是整張圖唯一不能妥協的結構 —— 對不齊的話「換濾心那天 PPM 掉下來」
 * 這個因果關係就看不出來，而那正是這張圖存在的理由。
 */

/** 兩個 grid 共用的左右邊距。改這裡兩邊一起動，不可能對不齊 */
const GRID_LEFT = 46
const GRID_RIGHT = 14
const PPM_TOP = 12
const PPM_HEIGHT = 220
/** 兩格之間留給 X 軸標籤與呼吸的空間 */
const GAP = 30
const LANE_ROW = 26

/** 泳道高度與整張圖的高度只算一次，避免容器高度與 grid 高度各算一份而對不上 */
function metrics(laneCount: number) {
  const laneHeight = Math.max(56, laneCount * LANE_ROW + 16)
  const laneTop = PPM_TOP + PPM_HEIGHT + GAP
  // 底部再留 34px 給 X 軸的日期標籤
  return { laneHeight, laneTop, total: laneTop + laneHeight + 34 }
}

/**
 * 把報表資料轉成 ECharts option。
 *
 * **抽成模組層的純函式而不是留在 useMemo 裡**，是為了讓時區對齊能被測試 ——
 * 這張圖的正確性取決於幾何（資料點與日界線對得上），
 * 而那只有把 option 交給真的 ECharts 去算座標才驗得出來。
 */
export function buildOption(
  data: ReportData,
  lanes: ReportData['lanes'],
  colors: ChartColors,
): EChartsOption {
  const laneNames = lanes.map((l) => l.name)
  const { laneHeight, laneTop } = metrics(lanes.length)

  /*
   * **兩個時間軸必須共用同一組 min/max。**
   *
   * ECharts 的每個軸會各自從自己的 series 推算範圍：上格看量測資料、
   * 下格看更換點。兩者的日期跨度幾乎永遠不同（量測是每月一筆、更換是每季一次），
   * 所以不指定的話同一個日期會落在不同的 x 像素 ——
   * 相同的 grid left/right 只保證「繪圖區」對齊，不保證「資料」對齊。
   *
   * 而對不齊的話「換濾心那天 PPM 掉下來」這個因果關係就看不出來，
   * 那正是這張圖存在的理由。
   *
   * 範圍取兩邊資料的聯集，再納入到期日的 markLine（它通常在未來，
   * 不納入的話虛線會被裁掉）。
   */
  const stamps: number[] = [
    ...data.readings.map((r) => r[0]),
    ...lanes.flatMap((l) => l.points.map((p) => p.ts)),
    ...lanes.map((l) => l.dueTs).filter((t): t is number => t !== null),
    data.range.toTs,
  ]
  const min = stamps.length ? Math.min(...stamps) : data.range.fromTs
  const max = stamps.length ? Math.max(...stamps) : data.range.toTs
  // 左右各留 2% 的邊，否則第一個與最後一個點會貼在邊界上被切一半
  const pad = Math.max(86_400_000, (max - min) * 0.02)
  const axisMin = min - pad
  const axisMax = max + pad

  return {
    /*
     * **必須是 UTC。**
     *
     * 這個 App 的日期是沒有時間的 `YYYY-MM-DD`，`toTs()` 一律轉成
     * UTC 午夜。而 ECharts 的 `time` 軸預設用**瀏覽器本地時區**決定
     * 刻度落點 —— 於是 9/15 那筆資料會畫在 x=366，標著「15」的刻度卻
     * 跑到 x=259（台北，差 8 小時）或 x=419（紐約，差 4 小時）。
     *
     * 後果不是標籤醜，是**讀錯日期**：更換泳道上的點與 PPM 折線都對得起來
     * （兩者用同一組 epoch），但它們整體相對日界線位移，
     * 「換濾心那天 PPM 掉下來」就會看起來發生在前一天或後一天。
     *
     * 這和 `fmtZh` 刻意用 UTC 格式化是同一個理由：資料層沒有「時刻」，
     * 任何把它當本地時刻解讀的環節都會憑空長出一個時區偏移。
     */
    useUTC: true,
    animation: false,
    backgroundColor: 'transparent',
    textStyle: {
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif',
    },

    // 一行讓十字準線跨面板連動。這是選 ECharts 而非 Recharts 的主因 ——
    // Recharts 的 syncId 在 Line ↔ Scatter 之間有已知的單向問題
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
      label: { backgroundColor: '#555' },
    },

    tooltip: {
      // trigger: 'axis' 而非 'item'：手指點在圖上任何位置都會吸附到最近的日期，
      // 不需要精準命中 13px 的圓點
      trigger: 'axis',
      // 手機上 hover 不存在，點擊才是唯一的互動
      triggerOn: 'click',
      // 不讓 tooltip 飛出圖表容器
      confine: true,
      /*
       * `axis: 'x'` 是必要的，不是保險。
       *
       * 泳道那一格的 Y 軸是 category 型，而 ECharts 的 axis 觸發在有
       * category 軸時會優先抓它 —— 結果是點在泳道上只會拿到
       * 上格的 PPM，而該日期的更換項目不會進 params，
       * 「同時列出當天的 PPM 與所有更換項目」這個需求就達不到。
       */
      axisPointer: { type: 'cross', axis: 'x' },
      formatter: (params: unknown) => {
        const arr = Array.isArray(params) ? params : [params]
        if (arr.length === 0) return ''
        const first = arr[0] as { axisValue: number }
        const d = new Date(first.axisValue)
        const head = `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`

        // PPM 先、更換項目後：PPM 是主序列，而且每次都在，
        // 位置固定才不必每次重新找
        const ppmLines: string[] = []
        const replaceLines: string[] = []
        for (const p of arr as {
          seriesName: string
          seriesType: string
          value: unknown
          color: string
          data?: unknown
        }[]) {
          if (p.seriesType === 'line') {
            const v = (p.value as [number, number])[1]
            if (v === undefined || v === null) continue
            ppmLines.push(
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${p.seriesName} <b>${v}</b> ppm`,
            )
          } else {
            const label = (p.data as { label?: string })?.label
            replaceLines.push(
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>換了 ${p.seriesName}${label ? `：${label}` : ''}`,
            )
          }
        }
        const lines = [...ppmLines, ...replaceLines]
        return lines.length ? `${head}<br/>${lines.join('<br/>')}` : head
      },
    },

    // 兩指縮放與單指平移，跨兩個面板。五年資料在 375px 螢幕上沒有縮放是不可用的
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], zoomOnMouseWheel: true }],

    grid: [
      { left: GRID_LEFT, right: GRID_RIGHT, top: PPM_TOP, height: PPM_HEIGHT },
      { left: GRID_LEFT, right: GRID_RIGHT, top: laneTop, height: laneHeight },
    ],

    xAxis: [
      {
        type: 'time',
        gridIndex: 0,
        min: axisMin,
        max: axisMax,
        // splitNumber 也要一致，否則兩格的格線密度不同，
        // 看起來就像沒對齊 —— 即使資料座標其實是對的
        splitNumber: 5,
        // 上面那格不顯示日期標籤，避免同一組日期出現兩次
        axisLabel: { show: false },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: colors.grid } },
      },
      {
        type: 'time',
        gridIndex: 1,
        min: axisMin,
        max: axisMax,
        splitNumber: 5,
        axisLabel: { fontSize: 10, hideOverlap: true, color: colors.text },
        splitLine: { show: true, lineStyle: { color: colors.grid } },
      },
    ],

    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        name: 'ppm',
        nameTextStyle: { fontSize: 10, align: 'left', color: colors.text },
        axisLabel: { fontSize: 10, color: colors.text },
        splitLine: { lineStyle: { color: colors.grid } },
        min: 0,
      },
      {
        type: 'category',
        gridIndex: 1,
        data: laneNames,
        // 由上而下對應第一道 → 第六道，與設定頁的順序一致
        inverse: true,
        axisLabel: { fontSize: 10, width: GRID_LEFT - 8, overflow: 'truncate', color: colors.text },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: colors.grid } },
      },
    ],

    series: [
      {
        name: '原水',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: data.readings.map((r) => [r[0], r[1]]),
        // canvas 不解析 CSS 變數，所以這裡必須是實際色值（見 useChartColors）
        itemStyle: { color: colors.raw },
        lineStyle: { width: 2 },
        symbolSize: 6,
        connectNulls: true,
      },
      {
        name: '純水',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: data.readings.map((r) => [r[0], r[2]]),
        itemStyle: { color: colors.pure },
        lineStyle: { width: 2 },
        symbolSize: 6,
        connectNulls: true,
      },
      ...lanes.map((lane) => ({
        name: lane.name,
        type: 'scatter' as const,
        xAxisIndex: 1,
        yAxisIndex: 1,
        symbolSize: 13,
        itemStyle: { color: lane.color },
        data: lane.points.map((p) => ({ value: [p.ts, lane.name], label: p.label })),
        // 下次更換日用虛線標出來。markLine 可以落在資料範圍之外，
        // 這正是需要的 —— 到期日通常在未來
        markLine:
          lane.dueTs === null
            ? undefined
            : {
                silent: true,
                symbol: 'none',
                lineStyle: {
                  type: 'dashed' as const,
                  color: lane.overdue ? colors.danger : lane.color,
                  width: 1,
                  opacity: 0.6,
                },
                label: { show: false },
                data: [{ xAxis: lane.dueTs }],
              },
      })),
    ],
  }
}

export function PpmChart({
  data,
  hidden,
}: {
  data: ReportData
  /** 被圖例篩掉的種類 id */
  hidden: Set<number>
}) {
  const lanes = useMemo(() => data.lanes.filter((l) => !hidden.has(l.categoryId)), [data.lanes, hidden])

  const colors = useChartColors()

  const option = useMemo(() => buildOption(data, lanes, colors), [data, lanes, colors])

  const { ref } = useEChart(option, [option])

  return (
    <div
      ref={ref}
      role="img"
      aria-label="原水與純水 PPM 折線圖，以及各種類的更換時間泳道"
      // touch-action: pan-y 讓垂直捲動仍歸頁面，只有兩指縮放與水平拖曳給圖表。
      // 沒有這一行，手指在圖上往下滑會被 dataZoom 吃掉，整頁捲不動
      style={{ touchAction: 'pan-y', height: metrics(lanes.length).total }}
      className="w-full"
    />
  )
}
