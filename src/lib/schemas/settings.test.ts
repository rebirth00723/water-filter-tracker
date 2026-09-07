import { describe, expect, it } from 'vitest'
import {
  categoryFields,
  categoryFormSchema,
  createCategory,
  deviceFields,
  itemFields,
  reorderDevices,
  updateCategory,
} from './settings'

const baseCategory = {
  name: '第一道',
  color: '#14B8A6',
  cyclePeriod: '',
  cycleUnit: 'MONTH' as const,
  baselineOn: '',
  notifyEnabled: true,
  active: true,
}

describe('deviceFields', () => {
  it('空字串一律轉成 null，資料庫裡不會出現兩種「空」', () => {
    const out = deviceFields.parse({
      name: '  廚下 RO  ',
      model: '',
      installedOn: '',
      ntfyTopic: '   ',
      active: true,
    })
    expect(out).toEqual({
      name: '廚下 RO', // 前後空白被 trim
      model: null,
      installedOn: null,
      ntfyTopic: null, // 只有空白也算空
      active: true,
    })
  })

  it('名稱只有空白時視為未填', () => {
    const r = deviceFields.safeParse({ name: '   ', model: '', installedOn: '', ntfyTopic: '', active: true })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].message).toBe('請填寫設備名稱')
  })

  it('字數上限算的是 trim 之後的長度', () => {
    // trim 必須排在 max 之前，否則使用者貼上帶空白的文字會被誤判超長
    const name = 'a'.repeat(40)
    expect(deviceFields.parse({ name: `  ${name}  `, model: '', installedOn: '', ntfyTopic: '', active: true }).name)
      .toBe(name)
    expect(
      deviceFields.safeParse({ name: 'a'.repeat(41), model: '', installedOn: '', ntfyTopic: '', active: true }).success,
    ).toBe(false)
  })

  it('日期擋掉不存在的日子，不只驗格式', () => {
    const bad = deviceFields.safeParse({
      name: 'x', model: '', installedOn: '2026-02-31', ntfyTopic: '', active: true,
    })
    expect(bad.success).toBe(false)
    const loose = deviceFields.safeParse({
      name: 'x', model: '', installedOn: '2026-2-7', ntfyTopic: '', active: true,
    })
    expect(loose.success).toBe(false)
    expect(
      deviceFields.parse({ name: 'x', model: '', installedOn: '2026-02-28', ntfyTopic: '', active: true }).installedOn,
    ).toBe('2026-02-28')
  })
})

describe('categoryFields', () => {
  it('色碼一律正規化成小寫', () => {
    // 這個值會直送 ECharts 與 inline style，格式統一才不必在每個消費端各正規化一次
    expect(categoryFields.parse(baseCategory).color).toBe('#14b8a6')
  })

  it('拒絕簡寫與色彩名稱', () => {
    for (const color of ['#fff', 'red', 'rgb(1,2,3)', '14b8a6']) {
      expect(categoryFields.safeParse({ ...baseCategory, color }).success).toBe(false)
    }
  })

  it('週期留空＝不設，而不是 0', () => {
    expect(categoryFields.parse({ ...baseCategory, cyclePeriod: '' }).cyclePeriod).toBeNull()
    expect(categoryFields.parse({ ...baseCategory, cyclePeriod: '  ' }).cyclePeriod).toBeNull()
  })

  it('週期是字串進、數字出', () => {
    expect(categoryFields.parse({ ...baseCategory, cyclePeriod: '6' }).cyclePeriod).toBe(6)
  })

  it('週期不接受 0、負數與小數', () => {
    for (const v of ['0', '-1', '1.5']) {
      expect(categoryFields.safeParse({ ...baseCategory, cyclePeriod: v }).success).toBe(false)
    }
  })

  it('週期上限依單位而不同（這是 superRefine 存在的理由）', () => {
    // 200 個月超過上限（120），但 200 天在上限內（3650）——
    // 同一個數值合法與否取決於另一個欄位，單一欄位的 max() 做不到這件事
    const asMonths = createCategory.safeParse({
      ...baseCategory, deviceId: 1, cyclePeriod: '200', cycleUnit: 'MONTH',
    })
    expect(asMonths.success).toBe(false)
    expect(asMonths.error!.issues[0].path).toEqual(['cyclePeriod'])
    expect(asMonths.error!.issues[0].message).toContain('120')

    expect(
      createCategory.safeParse({ ...baseCategory, deviceId: 1, cyclePeriod: '200', cycleUnit: 'DAY' }).success,
    ).toBe(true)
  })

  it('不設週期時不檢查上限', () => {
    expect(
      createCategory.safeParse({ ...baseCategory, deviceId: 1, cyclePeriod: '', cycleUnit: 'MONTH' }).success,
    ).toBe(true)
  })

  it('cycleUnit 只接受列舉值', () => {
    expect(categoryFields.safeParse({ ...baseCategory, cycleUnit: 'WEEK' }).success).toBe(false)
  })
})

describe('itemFields', () => {
  it('預設數量是字串進、數字出', () => {
    const out = itemFields.parse({ name: 'PP 棉', brand: '', defaultQty: '2', active: true })
    expect(out.defaultQty).toBe(2)
    expect(out.brand).toBeNull()
  })

  it('預設數量不接受 0 或空白', () => {
    for (const v of ['0', '', '  ', '-3', '2.5']) {
      expect(itemFields.safeParse({ name: 'x', brand: '', defaultQty: v, active: true }).success).toBe(false)
    }
  })
})

describe('reorderDevices', () => {
  it('id 陣列不能是空的', () => {
    expect(reorderDevices.safeParse({ ids: [] }).success).toBe(false)
    expect(reorderDevices.parse({ ids: ['3', '1', '2'] }).ids).toEqual([3, 1, 2])
  })
})

describe('客戶端與伺服端用同一組規則', () => {
  /*
   * 這一組測試存在的理由：表單原本用不帶 superRefine 的 categoryFields，
   * 所以週期上限只有伺服端會擋 —— 使用者要按下儲存、等一次往返，
   * 才會看到一則 toast，而不是欄位旁的即時提示。
   * 共用 schema 的價值就在兩邊規則不漂移，只在一側加檢查等於放棄了它。
   */
  const over = { ...baseCategory, cyclePeriod: '200', cycleUnit: 'MONTH' as const }

  it('表單用的 schema 也會擋掉超出單位上限的週期', () => {
    const r = categoryFormSchema.safeParse(over)
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].path).toEqual(['cyclePeriod'])
  })

  it('表單、新增、修改三個 schema 對同一筆輸入的判斷一致', () => {
    expect(categoryFormSchema.safeParse(over).success).toBe(false)
    expect(createCategory.safeParse({ ...over, deviceId: 1 }).success).toBe(false)
    expect(updateCategory.safeParse({ ...over, id: 1 }).success).toBe(false)

    const ok = { ...baseCategory, cyclePeriod: '6', cycleUnit: 'MONTH' as const }
    expect(categoryFormSchema.safeParse(ok).success).toBe(true)
    expect(createCategory.safeParse({ ...ok, deviceId: 1 }).success).toBe(true)
    expect(updateCategory.safeParse({ ...ok, id: 1 }).success).toBe(true)
  })
})
