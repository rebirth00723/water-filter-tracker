/**
 * PPM 的純計算，**刻意不匯入資料庫** —— 這些函式在 Client Component 裡也要用
 * （表單即時顯示去除率、清單顯示每一列的去除率）。
 *
 * 放在 readings-store 裡的話，一個值匯入就會把 better-sqlite3 整包拉進
 * 瀏覽器 bundle。那不是型別錯誤，所以 tsc 不會抱怨 —— 只有建置會失敗，
 * 而錯誤訊息是一長串 module-not-found 的追蹤，看不出真正的原因。
 */

/**
 * 去除率（%）。這是判斷濾心衰退的實際訊號 ——
 * 原水本身會隨季節與水源變動，所以單看純水的絕對值會誤判：
 * 原水從 180 漲到 260 時純水跟著從 12 漲到 18，濾心其實沒有變差。
 *
 * 原水為 0 時回 null 而不是 0 或 100：那代表量測有問題，
 * 硬算出一個數字只會在圖上畫出一個假的谷底。
 */
export function rejectionRate(rawPpm: number, purePpm: number): number | null {
  if (rawPpm <= 0) return null
  return ((rawPpm - purePpm) / rawPpm) * 100
}
