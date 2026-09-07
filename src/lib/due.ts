import { addPeriod, diffDays } from './date'
import type { CycleUnit } from './db/schema'

/**
 * 下次更換日的推算。**刻意是純函式、不碰資料庫** ——
 * 這是整個 App 唯一會被使用者拿去對照日曆的計算，必須能單獨測到底。
 */

/** 起算日的來源。四階梯，新購不算 —— 買回來放著不裝，濾心不會開始衰退 */
export const DUE_BASES = ['REPLACE', 'BASELINE', 'DEVICE_INSTALL', 'NONE'] as const
export type DueBasis = (typeof DUE_BASES)[number]

export interface DueInput {
  cyclePeriod: number | null
  cycleUnit: CycleUnit
  /** 該種類最後一次 REPLACE 事件的日期 */
  lastReplacedOn: string | null
  /** categories.baselineOn，「裝機時就換過」 */
  baselineOn: string | null
  /** devices.installedOn */
  deviceInstalledOn: string | null
  today: string
}

export interface DueResult {
  basis: DueBasis
  /** 起算日。basis 為 NONE 時是 null */
  since: string | null
  /** 下次更換日。沒有起算日或沒設週期時是 null */
  dueOn: string | null
  /** 距今天數。負數＝已逾期幾天 */
  daysLeft: number | null
  /** 已逾期 */
  overdue: boolean
}

/**
 * 四階梯，依序取第一個有值的：
 *
 * | 順序 | 來源 | basis |
 * |---|---|---|
 * | 1 | 該種類最後一次 REPLACE 的日期 | `REPLACE` |
 * | 2 | `categories.baselineOn` | `BASELINE` |
 * | 3 | `devices.installedOn` | `DEVICE_INSTALL` |
 * | 4 | 都沒有 | `NONE` |
 *
 * **第 4 階必須回 null，絕不可以編一個假的到期日。**
 * 錯的到期日比沒有到期日更糟 —— 沒有到期日時使用者知道要去設起算日，
 * 而一個看起來很合理的錯誤日期會讓人以為還有三個月，然後濾心爆掉。
 *
 * 沒設週期（`cyclePeriod === null`）時同樣回 null 的 dueOn，但 basis 仍然有值 ——
 * 「知道上次什麼時候換的、但沒有設定週期」與「連上次什麼時候換的都不知道」
 * 是兩種不同的狀態，UI 要能分開講。
 */
export function computeDue(input: DueInput): DueResult {
  const { basis, since } = pickBasis(input)

  if (since === null || input.cyclePeriod === null) {
    return { basis, since, dueOn: null, daysLeft: null, overdue: false }
  }

  const dueOn = addPeriod(since, input.cyclePeriod, input.cycleUnit)
  const daysLeft = diffDays(dueOn, input.today)
  return { basis, since, dueOn, daysLeft, overdue: daysLeft < 0 }
}

function pickBasis(input: DueInput): { basis: DueBasis; since: string | null } {
  if (input.lastReplacedOn) return { basis: 'REPLACE', since: input.lastReplacedOn }
  if (input.baselineOn) return { basis: 'BASELINE', since: input.baselineOn }
  if (input.deviceInstalledOn) return { basis: 'DEVICE_INSTALL', since: input.deviceInstalledOn }
  return { basis: 'NONE', since: null }
}

/** 給使用者看的起算日來源說明 */
export function basisLabel(basis: DueBasis): string {
  switch (basis) {
    case 'REPLACE':
      return '依上次更換日'
    case 'BASELINE':
      return '依種類的起算日'
    case 'DEVICE_INSTALL':
      return '依設備裝機日'
    case 'NONE':
      return '尚未設定起算日'
  }
}

/**
 * 到期狀態，用於決定顏色與排序。
 *
 * `PURCHASED` 是刻意獨立出來的一種狀態：庫存有貨但從來沒換過 ——
 * 使用者已經買了、只是還沒裝。這時候該提醒的是「去裝」而不是「去買」，
 * 兩者混在一起會讓提醒失去作用。
 */
export type DueStatus = 'OVERDUE' | 'SOON' | 'OK' | 'PURCHASED' | 'UNSET'

export function dueStatus(
  due: DueResult,
  stock: number,
  soonWithinDays = 14,
): DueStatus {
  if (due.basis === 'NONE') {
    return stock > 0 ? 'PURCHASED' : 'UNSET'
  }
  if (due.dueOn === null) return 'UNSET'
  if (due.overdue) return 'OVERDUE'
  if (due.daysLeft !== null && due.daysLeft <= soonWithinDays) return 'SOON'
  // 已購入但還沒換過：該提醒的是去裝，不是去買
  if (stock > 0 && due.basis !== 'REPLACE') return 'PURCHASED'
  return 'OK'
}

export function dueStatusLabel(status: DueStatus, due: DueResult): string {
  switch (status) {
    case 'OVERDUE':
      return `已逾期 ${Math.abs(due.daysLeft!)} 天`
    case 'SOON':
      return due.daysLeft === 0 ? '今天到期' : `剩 ${due.daysLeft} 天`
    case 'OK':
      return `剩 ${due.daysLeft} 天`
    case 'PURCHASED':
      return '已購入，尚未更換'
    case 'UNSET':
      return due.basis === 'NONE' ? '尚未設定起算日' : '未設週期'
  }
}
