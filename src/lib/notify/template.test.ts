import { describe, expect, it } from 'vitest'
import { SAMPLE_VARS, renderTemplate } from './template'

describe('renderTemplate', () => {
  it('替換所有已知變數', () => {
    expect(
      renderTemplate('{device} 的{category}再 {days} 天就該換了（預計 {dueOn}）', SAMPLE_VARS),
    ).toBe('廚下 RO 的第一道再 14 天就該換了（預計 2026年11月1日）')
  })

  it('未知變數原樣保留，不換成空字串', () => {
    // 留著才看得出是打錯字。替換成空字串會產生一句讀起來很奇怪但看不出原因的訊息
    expect(renderTemplate('{device} 的 {catagory} 該換了', SAMPLE_VARS)).toBe(
      '廚下 RO 的 {catagory} 該換了',
    )
  })

  it('同一個變數可以出現多次', () => {
    expect(renderTemplate('{days} 天，只剩 {days} 天', SAMPLE_VARS)).toBe('14 天，只剩 14 天')
  })

  it('沒有變數的樣板原樣輸出', () => {
    expect(renderTemplate('該換濾心了', SAMPLE_VARS)).toBe('該換濾心了')
  })

  it('dueOn 會轉成中文日期而不是原始字串', () => {
    expect(renderTemplate('{dueOn}', SAMPLE_VARS)).not.toContain('2026-11-01')
    expect(renderTemplate('{dueOn}', SAMPLE_VARS)).toContain('2026年11月1日')
  })

  it('items 可能是空字串（該種類底下沒有耗材）', () => {
    expect(renderTemplate('要換 {items}', { ...SAMPLE_VARS, items: '' })).toBe('要換 ')
  })
})
