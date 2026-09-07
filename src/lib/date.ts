/**
 * 日期工具：使用者可見的日期一律是「日曆上的日期」而非時間點，
 * 因此全部以 YYYY-MM-DD 字串處理，不引入日期函式庫。
 *
 * 字典序等於時序，所以 SQLite 的 ORDER BY / BETWEEN / MAX() 可直接用；
 * 跨 Server/Client 邊界不需序列化；z.iso.date() 可精確驗證。
 *
 * 時區轉換只有 todayTpe() 一處，走 Intl（Node 內建 ICU），
 * 因此正確性不依賴容器的 TZ 環境變數與 tzdata。
 */
const TZ = process.env.APP_TZ ?? 'Asia/Taipei'

// en-CA 的日期格式天生就是 YYYY-MM-DD
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ })
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })
const zhFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, dateStyle: 'medium' })

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** 今天（Asia/Taipei），格式 YYYY-MM-DD */
export function todayTpe(now: Date = new Date()): string {
  return ymdFmt.format(now)
}

/** 現在的當地小時（0-23），用於「每天幾點之後才送通知」 */
export function hourTpe(now: Date = new Date()): number {
  return Number(hourFmt.format(now))
}

/** YYYY-MM-DD -> UTC 午夜的 epoch ms。也是圖表的 X 值 */
export function toTs(ymd: string): number {
  if (!YMD_RE.test(ymd)) throw new RangeError(`不合法的日期字串：${ymd}`)
  const t = Date.parse(`${ymd}T00:00:00Z`)
  if (Number.isNaN(t)) throw new RangeError(`不合法的日期字串：${ymd}`)
  return t
}

function fromTs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

const DAY = 86_400_000

export function addDays(ymd: string, n: number): string {
  return fromTs(toTs(ymd) + n * DAY)
}

/** a - b，單位為天。a 在 b 之後為正 */
export function diffDays(a: string, b: string): number {
  return Math.round((toTs(a) - toTs(b)) / DAY)
}

/** 加月份，月底夾擠：2026-01-31 加 1 個月 -> 2026-02-28 */
export function addMonths(ymd: string, n: number): string {
  if (!YMD_RE.test(ymd)) throw new RangeError(`不合法的日期字串：${ymd}`)
  const [y, m, d] = ymd.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

/** 依週期單位推算下次日期 */
export function addPeriod(ymd: string, n: number, unit: 'DAY' | 'MONTH'): string {
  return unit === 'MONTH' ? addMonths(ymd, n) : addDays(ymd, n)
}

/** 顯示用：2026-09-05 -> 2026年9月5日 */
export function fmtZh(ymd: string): string {
  return zhFmt.format(new Date(toTs(ymd)))
}

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
