'use client'

import { useEffect, useState } from 'react'

/**
 * 從 CSS 變數讀出實際色值。
 *
 * **必要，不是講究。** ECharts 用 canvas 繪製，而 canvas 的 fillStyle
 * **不解析 CSS 變數** —— 直接把 `var(--chart-raw)` 丟進 itemStyle.color
 * 會得到一個無效值，圖上那條線會變黑或根本畫不出來。
 *
 * 讀出來之後還要跟著主題變 —— 這個 App 的暗色模式走 prefers-color-scheme，
 * 使用者在系統設定裡切換時圖表要跟上，否則暗底上會出現一條為亮底調的淡色線。
 */
export interface ChartColors {
  raw: string
  pure: string
  text: string
  grid: string
  danger: string
}

function read(): ChartColors {
  if (typeof window === 'undefined') {
    return { raw: '#f97316', pure: '#2563eb', text: '#16191d', grid: 'rgba(128,128,128,0.15)', danger: '#dc2626' }
  }
  const cs = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    raw: get('--chart-raw', '#f97316'),
    pure: get('--chart-pure', '#2563eb'),
    text: get('--foreground', '#16191d'),
    grid: 'rgba(128,128,128,0.15)',
    danger: get('--destructive', '#dc2626'),
  }
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(read)

  useEffect(() => {
    setColors(read())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setColors(read())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return colors
}
