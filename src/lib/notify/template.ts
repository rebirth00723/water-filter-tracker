import { fmtZh } from '../date'

/**
 * 訊息樣板。變數：{device} {category} {items} {days} {dueOn}
 *
 * 刻意不做運算式或條件式 —— 那會變成一個要維護的小語言，
 * 而使用者真正想改的只有語氣與要不要提到某個欄位。
 * 未知的變數**原樣保留**而不是替換成空字串：留著才看得出是打錯字。
 */
export interface TemplateVars {
  device: string
  category: string
  /** 「PP 棉×2 RO 膜×1」 */
  items: string
  /** ADVANCE 是剩餘天數；OVERDUE 是已逾期天數。兩者都是正數 */
  days: number
  dueOn: string
}

const KNOWN = ['device', 'category', 'items', 'days', 'dueOn'] as const

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!(KNOWN as readonly string[]).includes(name)) return whole
    if (name === 'dueOn') return fmtZh(vars.dueOn)
    return String(vars[name as keyof TemplateVars])
  })
}

/** 設定頁的預覽用。填一組看得懂的假資料 */
export const SAMPLE_VARS: TemplateVars = {
  device: '廚下 RO',
  category: '第一道',
  items: 'PP 棉濾心×1',
  days: 14,
  dueOn: '2026-11-01',
}

export function templateVariables(): { name: string; desc: string }[] {
  return [
    { name: '{device}', desc: '設備名稱' },
    { name: '{category}', desc: '種類名稱，例如「第一道」' },
    { name: '{items}', desc: '該種類底下的耗材與數量' },
    { name: '{days}', desc: '剩餘天數（逾期通知則是已逾期天數）' },
    { name: '{dueOn}', desc: '到期日，會以中文格式顯示' },
  ]
}
