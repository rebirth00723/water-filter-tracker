/**
 * 日期工具：使用者可見的日期一律是「日曆上的日期」而非時間點，
 * 因此全部以 YYYY-MM-DD 字串處理，不引入日期函式庫。
 *
 * 字典序等於時序，所以 SQLite 的 ORDER BY / BETWEEN / MAX() 可直接用；
 * 跨 Server/Client 邊界不需序列化；z.iso.date() 可精確驗證。
 *
 * ## 時區只出現在兩個函式裡
 *
 * `today()` 與 `currentHour()` 需要知道「現在」是哪一天、幾點 ——
 * 那必然涉及時區，而它們**只在伺服端使用**（決定到期、決定該不該發通知）。
 *
 * 其餘全部與時區無關。特別是 `fmtZh()`：它把一個日曆日期字串排版成中文，
 * 那件事沒有時區可言。**它刻意用 UTC 格式化** —— 傳進來的時間戳是該日期的
 * UTC 午夜，用 UTC 排版就永遠得到同一個日曆日期，伺服端與客戶端一致。
 *
 * 這不是講究：`fmtZh` 被 7 個 Client Component 使用，而客戶端讀不到 `TZ`
 * （Next 只注入 NEXT_PUBLIC_ 開頭的）。若它依賴時區，
 * 一個在 UTC-10 的瀏覽器會把每個日期都渲染成前一天，
 * 而且與伺服端的 HTML 不一致 —— 那是 hydration 錯誤加上錯的資料。
 */

/**
 * App 的時區。
 *
 * 讀 `TZ` —— Node 與 Docker 的標準變數，不自創另一個名字。
 * （這裡原本讀的是 `APP_TZ`，而 Dockerfile 與 compose 設的是 `TZ` ——
 * 於是使用者設了時區卻沒有任何作用，所有日期與到期日仍然用寫死的台北時間。）
 *
 * 未設時用系統時區：本機開發的人預期看到自己的時區，
 * 而容器裡 Dockerfile 已經預設 `TZ=Asia/Taipei`，行為是確定的。
 */
function resolveTimeZone(): string {
  const raw = process.env.TZ?.trim()
  const system = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  })()
  if (!raw) return system

  /*
   * `TZ` 打錯字時 Intl 會丟 RangeError。
   * 若不接住，這個模組在載入期就爆掉 —— 整個容器起不來，
   * 而錯誤訊息完全看不出是一個環境變數的拼字問題。
   * 退回系統時區並在 stderr 留一行，讓服務仍然可用。
   */
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: raw }).format(new Date(0))
    return raw
  } catch {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: `TZ 的值「${raw}」不是合法的 IANA 時區名稱，已退回系統時區「${system}」。` +
          `請改用像 Asia/Taipei、Europe/Berlin 這樣的名稱。`,
      }),
    )
    return system
  }
}

export const APP_TIME_ZONE = resolveTimeZone()

// en-CA 的日期格式天生就是 YYYY-MM-DD
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE })
const hourFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  hour12: false,
})
const minuteFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  minute: '2-digit',
})
// ↓ 刻意固定 UTC，見檔頭說明
const zhFmt = new Intl.DateTimeFormat('zh-TW', { timeZone: 'UTC', dateStyle: 'medium' })

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 今天（依 APP_TIME_ZONE），格式 YYYY-MM-DD。**伺服端專用。**
 *
 * 名字與 `currentHour()` 成對，而且刻意不叫 `today()` ——
 * 呼叫端幾乎都會寫 `const today = currentDate()`，
 * 若函式也叫 today 就會遮蔽掉自己，那是個編譯錯誤但要花幾秒才看懂。
 */
export function currentDate(now: Date = new Date()): string {
  return ymdFmt.format(now)
}

/** 現在的當地小時（0-23），用於「每天幾點之後才送通知」。**伺服端專用** */
export function currentHour(now: Date = new Date()): number {
  return Number(hourFmt.format(now))
}

/**
 * 現在的當地分鐘（0-59）。**伺服端專用**
 *
 * 通知的發送時刻是 `<input type="time">`，使用者填得出 07:30 ——
 * 只看小時的話那則通知會在 07:00 的掃描就送出，提早 30 分鐘。
 */
export function currentMinute(now: Date = new Date()): number {
  return Number(minuteFmt.format(now))
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

/**
 * 顯示用：2026-09-05 -> 2026年9月5日
 *
 * 與時區無關（用 UTC 格式化 UTC 午夜），所以在 Client Component 裡安全。
 */
export function fmtZh(ymd: string): string {
  return zhFmt.format(new Date(toTs(ymd)))
}

/*
 * ## 時間點（epoch ms）的顯示
 *
 * 時間點要轉成人看的字串**必然涉及時區**，所以這兩個函式是**伺服端專用**：
 * 客戶端讀不到 `TZ`，自己轉會得到瀏覽器的時區。
 *
 * 呼叫端的規則是：**在伺服端格式化好，把字串放進 props 傳下去。**
 *
 * 不要在 Client Component 裡寫 `new Date(ms).toISOString().slice(0, 10)` ——
 * 那是把時間點轉成 **UTC** 的日曆日期。台北（UTC+8）在 9/8 早上 7 點發生的事
 * 在 UTC 是 9/7 23:00，於是畫面會顯示 9 月 7 日，**差一天**。
 */
const dateTimeFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: APP_TIME_ZONE,
  dateStyle: 'short',
  timeStyle: 'short',
})
const dateOnlyFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: APP_TIME_ZONE,
  dateStyle: 'medium',
})

/** epoch ms -> 「2026/9/8 上午7:00」。**伺服端專用** */
export function fmtDateTime(ms: number): string {
  return dateTimeFmt.format(new Date(ms))
}

/** epoch ms -> 「2026年9月8日」。**伺服端專用** */
export function fmtDateOnly(ms: number): string {
  return dateOnlyFmt.format(new Date(ms))
}

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
