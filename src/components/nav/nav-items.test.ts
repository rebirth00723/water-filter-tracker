import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, isNavActive, navDeviceId, navHref } from './nav-items'

const [home, consumables, water, report, settings] = NAV_ITEMS

describe('navHref', () => {
  it('前四個分頁綁設備，設定不綁', () => {
    expect(navHref(home, 3)).toBe('/d/3')
    expect(navHref(consumables, 3)).toBe('/d/3/consumables')
    expect(navHref(water, 3)).toBe('/d/3/water')
    expect(navHref(report, 3)).toBe('/d/3/report')
    expect(navHref(settings, 3)).toBe('/settings')
  })

  it('一台設備都沒有時，前四個分頁導向設備清單而不是死連結', () => {
    expect(navHref(home, null)).toBe('/settings/devices')
    expect(navHref(water, null)).toBe('/settings/devices')
    expect(navHref(settings, null)).toBe('/settings')
  })
})

describe('isNavActive', () => {
  it('設備首頁只在首頁時亮', () => {
    expect(isNavActive('/d/1', home)).toBe(true)
    expect(isNavActive('/d/1/', home)).toBe(true)
    expect(isNavActive('/d/1/water', home)).toBe(false)
  })

  it('各分頁只亮自己那一個', () => {
    expect(isNavActive('/d/1/water', water)).toBe(true)
    expect(isNavActive('/d/1/water', consumables)).toBe(false)
    expect(isNavActive('/d/1/consumables/new', consumables)).toBe(true)
  })

  it('設定用前綴比對，子頁面也算', () => {
    expect(isNavActive('/settings', settings)).toBe(true)
    expect(isNavActive('/settings/devices/2', settings)).toBe(true)
    expect(isNavActive('/d/1/water', settings)).toBe(false)
  })

  it('在設定頁時沒有任何設備分頁是亮的', () => {
    // /settings/devices/2 裡有數字，但那是設定頁的路徑而不是設備路徑
    for (const item of [home, consumables, water, report]) {
      expect(isNavActive('/settings/devices/2', item)).toBe(false)
    }
  })
})

describe('navDeviceId', () => {
  it('網址優先於備援值', () => {
    // 這是關鍵：從切換器跳到設備 2 的那一次請求，伺服端的 cookie 還是 1。
    // 若採用 cookie，畫面顯示設備 2 而分頁連結指向設備 1。
    expect(navDeviceId('/d/2/water', 1)).toBe(2)
  })

  it('網址沒有設備時才用備援值', () => {
    expect(navDeviceId('/settings', 1)).toBe(1)
    expect(navDeviceId('/settings', null)).toBeNull()
  })
})
