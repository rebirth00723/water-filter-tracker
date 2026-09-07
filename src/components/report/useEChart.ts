'use client'

import { LineChart, ScatterChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  DataZoomInsideComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

/**
 * ECharts 的 init / setOption / resize / dispose。
 *
 * **自己寫而不用 echarts-for-react**：後者在 React 19 下有 resize observer
 * 的已知錯誤，而需要的功能就是這三十行。
 *
 * **tree-shaken 匯入**：`import * as echarts from 'echarts'` 會帶進約 1MB，
 * 而這張圖只用到 line、scatter、grid、tooltip、axisPointer、markLine 與 inside 縮放。
 */
echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  // 跨面板的十字準線靠這個元件 + axisPointer.link
  AxisPointerComponent,
  // 下次更換日的虛線
  MarkLineComponent,
  // 只註冊 inside：不要 slider，手機上那條拉桿佔掉的高度比它帶來的價值多
  DataZoomInsideComponent,
  CanvasRenderer,
])

export type EChartsOption = echarts.EChartsCoreOption

export function useEChart(option: EChartsOption, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const chart = echarts.init(el, undefined, { renderer: 'canvas' })
    chartRef.current = chart

    // ResizeObserver 而不是 window.resize：側邊欄展開、抽屜開關都會改變容器寬度
    // 而那些都不會觸發 window 的 resize 事件
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    // notMerge: true —— 種類被篩掉時 series 數量會變少，
    // 合併模式下舊的 series 會留在圖上不消失
    chart.setOption(option, { notMerge: true })
    /*
     * setOption 之後明確 resize 一次。
     *
     * **不能只靠 ResizeObserver。** 篩掉一條泳道會同時改變 option 與容器高度，
     * 而 React 的 effect 是同步執行、ResizeObserver 的回呼是批次延後送達的 ——
     * 順序上 setOption 先跑完，觀察器才知道高度變了，於是 ECharts 的內部
     * 包裝與 canvas 會停在舊高度，畫面下方留一塊空白。
     *
     * 高度是從同一份 option 資料算出來的，所以這裡就是正確的時機。
     */
    chart.resize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { ref, chart: chartRef }
}
