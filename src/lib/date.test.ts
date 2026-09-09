import { afterAll, describe, expect, it, vi } from 'vitest'
import { addDays, addMonths, addPeriod, cmp, currentDate, diffDays, fmtZh, toTs } from './date'

/**
 * 時區的測試會動 process.env.TZ 並重新載入模組（APP_TIME_ZONE 是模組層級的常數），
 * 所以跑完要還原 —— 否則同一個 worker 裡後面的測試會拿到被改過的時區。
 */
const ORIGINAL_TZ = process.env.TZ
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})


describe('date', () => {
  it('currentDate 產出 YYYY-MM-DD', () => {
    expect(currentDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('currentDate 用設定的時區而非 UTC', () => {
    // 2026-09-05 17:30 UTC = 2026-09-06 01:30 台北
    expect(currentDate(new Date('2026-09-05T17:30:00Z'))).toBe('2026-09-06')
    expect(currentDate(new Date('2026-09-05T15:59:00Z'))).toBe('2026-09-05')
  })

  it('addDays 跨月與跨年', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29') // 閏年
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('addMonths 夾擠到月底', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28')
    expect(addMonths('2026-03-15', 12)).toBe('2027-03-15')
  })

  it('addPeriod 依單位分派', () => {
    expect(addPeriod('2026-09-05', 6, 'MONTH')).toBe('2027-03-05')
    expect(addPeriod('2026-09-05', 90, 'DAY')).toBe('2026-12-04')
  })

  it('diffDays', () => {
    expect(diffDays('2026-09-05', '2026-09-01')).toBe(4)
    expect(diffDays('2026-09-01', '2026-09-05')).toBe(-4)
    expect(diffDays('2027-01-01', '2026-01-01')).toBe(365)
  })

  it('字典序等於時序', () => {
    const arr = ['2026-10-01', '2026-09-30', '2025-12-31']
    expect([...arr].sort(cmp)).toEqual(['2025-12-31', '2026-09-30', '2026-10-01'])
  })

  it('不合法的輸入直接拋錯，不靜默產生錯誤日期', () => {
    expect(() => toTs('2026-9-5')).toThrow()
    expect(() => toTs('2026-01-32')).toThrow()
    expect(() => addMonths('not-a-date', 1)).toThrow()
  })

  it('fmtZh', () => {
    expect(fmtZh('2026-09-05')).toContain('2026')
  })
})

describe('時區的來源與邊界', () => {
  it('fmtZh 與時區無關 —— 這是它能在 Client Component 裡用的前提', async () => {
    /*
     * fmtZh 被 7 個 Client Component 使用，而客戶端讀不到 TZ
     *（Next 只注入 NEXT_PUBLIC_ 開頭的）。
     * 若它依賴時區，一個在 UTC-10 的瀏覽器會把每個日期都渲染成前一天，
     * 而且與伺服端的 HTML 不一致 —— 那是 hydration 錯誤加上錯的資料。
     *
     * 驗法：在三個差異很大的時區各載入一次模組，輸出必須完全相同。
     */
    const outputs: string[] = []
    for (const tz of ['Pacific/Honolulu', 'Asia/Taipei', 'Pacific/Kiritimati']) {
      vi.resetModules()
      process.env.TZ = tz
      const m = await import('./date')
      outputs.push(m.fmtZh('2026-01-01') + '|' + m.fmtZh('2026-12-31'))
    }
    expect(new Set(outputs).size).toBe(1)
    expect(outputs[0]).toContain('2026年1月1日')
  })

  it('currentDate 真的跟著 TZ 走', async () => {
    // 這是修一個真 bug 時加的：原本讀的是 APP_TZ，而 Dockerfile 設的是 TZ，
    // 於是使用者設了時區卻沒有任何作用，日期永遠是寫死的台北時間
    const instant = new Date('2026-09-05T14:30:00Z')

    vi.resetModules()
    process.env.TZ = 'Asia/Taipei' // UTC+8 → 已經是 9/5 22:30
    expect((await import('./date')).currentDate(instant)).toBe('2026-09-05')

    vi.resetModules()
    process.env.TZ = 'Pacific/Kiritimati' // UTC+14 → 已經是 9/6
    expect((await import('./date')).currentDate(instant)).toBe('2026-09-06')

    vi.resetModules()
    process.env.TZ = 'Pacific/Honolulu' // UTC-10 → 還是 9/5 04:30
    expect((await import('./date')).currentDate(instant)).toBe('2026-09-05')

    vi.resetModules()
    process.env.TZ = 'America/Sao_Paulo' // UTC-3 → 9/5 11:30
    expect((await import('./date')).currentDate(instant)).toBe('2026-09-05')
  })

  it('currentHour 也跟著 TZ 走', async () => {
    const instant = new Date('2026-09-05T14:30:00Z')
    vi.resetModules()
    process.env.TZ = 'Asia/Taipei'
    expect((await import('./date')).currentHour(instant)).toBe(22)
    vi.resetModules()
    process.env.TZ = 'UTC'
    expect((await import('./date')).currentHour(instant)).toBe(14)
  })

  it('TZ 打錯字時退回系統時區，不讓服務起不來', async () => {
    /*
     * Intl 對不合法的時區名稱會丟 RangeError。若不接住，
     * 這個模組在載入期就爆掉 —— 整個容器起不來，
     * 而錯誤訊息完全看不出是一個環境變數的拼字問題。
     */
    vi.resetModules()
    process.env.TZ = 'Asia/Taipei/Nope'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await import('./date')
    // 模組載入成功，而且仍然能算日期
    expect(m.currentDate(new Date('2026-09-05T14:30:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(m.APP_TIME_ZONE).not.toBe('Asia/Taipei/Nope')
    // 而且有留下一行讓人查得到原因
    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0][0])).toContain('Asia/Taipei/Nope')
    spy.mockRestore()
  })

  it('TZ 未設時用系統時區而不是寫死台北', async () => {
    // 本機開發的人預期看到自己的時區；容器裡 Dockerfile 已預設 TZ
    vi.resetModules()
    delete process.env.TZ
    const m = await import('./date')
    expect(m.APP_TIME_ZONE).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})
