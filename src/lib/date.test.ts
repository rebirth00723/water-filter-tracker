import { describe, expect, it } from 'vitest'
import { addDays, addMonths, addPeriod, cmp, diffDays, fmtZh, todayTpe, toTs } from './date'

describe('date', () => {
  it('todayTpe 產出 YYYY-MM-DD', () => {
    expect(todayTpe()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('todayTpe 用台北時區而非 UTC', () => {
    // 2026-09-05 17:30 UTC = 2026-09-06 01:30 台北
    expect(todayTpe(new Date('2026-09-05T17:30:00Z'))).toBe('2026-09-06')
    expect(todayTpe(new Date('2026-09-05T15:59:00Z'))).toBe('2026-09-05')
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
