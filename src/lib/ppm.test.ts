import { describe, expect, it } from 'vitest'
import { rejectionRate } from './ppm'

describe('rejectionRate', () => {
  it('算的是去除的比例', () => {
    expect(rejectionRate(200, 10)).toBeCloseTo(95)
    expect(rejectionRate(100, 50)).toBeCloseTo(50)
    expect(rejectionRate(180, 0)).toBeCloseTo(100)
  })

  it('原水為 0 時回 null 而不是 0 或 100', () => {
    // 那代表量測有問題，硬算出一個數字只會在圖上畫出一個假的谷底
    expect(rejectionRate(0, 0)).toBeNull()
    expect(rejectionRate(-5, 0)).toBeNull()
  })

  it('去除率會隨原水波動保持穩定 —— 這正是它比純水絕對值可靠的原因', () => {
    // 夏天原水 180 / 純水 12，冬天原水 260 / 純水 17：
    // 純水的絕對值漲了 42%，但濾心其實沒有變差
    const summer = rejectionRate(180, 12)!
    const winter = rejectionRate(260, 17)!
    expect(Math.abs(summer - winter)).toBeLessThan(1)
  })
})
