/**
 * 挑選器需要的資料形狀。由伺服器算好傳下來 ——
 * 這些數字（庫存、逾期天數、上次單價）全部來自資料庫，
 * 而挑選器是 Client Component，不能自己去查。
 */
export interface PickerCategory {
  id: number
  name: string
  color: string
  /** 庫存可為負，如實顯示 */
  stock: number
  /** 逾期天數（正數）。null＝沒逾期或算不出來 */
  overdueDays: number | null
  /** 剩餘天數。null＝沒有到期日 */
  daysLeft: number | null
  statusLabel: string
  items: PickerItem[]
}

export interface PickerItem {
  id: number
  name: string
  brand: string | null
  defaultQty: number
  stock: number
  /** 「上次 $260 · 在露天買」 */
  lastPurchaseLabel: string | null
}
