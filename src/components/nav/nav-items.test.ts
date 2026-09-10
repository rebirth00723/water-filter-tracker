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
  const KNOWN = [1, 2, 3]

  it('網址優先於備援值', () => {
    // 這是關鍵：從切換器跳到設備 2 的那一次請求，伺服端的 cookie 還是 1。
    // 若採用 cookie，畫面顯示設備 2 而分頁連結指向設備 1。
    expect(navDeviceId('/d/2/water', 1, KNOWN)).toBe(2)
  })

  it('網址沒有設備時才用備援值', () => {
    expect(navDeviceId('/settings', 1, KNOWN)).toBe(1)
    expect(navDeviceId('/settings', null, KNOWN)).toBeNull()
  })

  it('網址裡的設備不存在時退回備援值，導覽列才不會是死路', () => {
    // 打開已刪除設備的舊連結（或貼在拆掉的機器上的 QR）會走到 404。
    // 只看網址的話，那一頁的五個分頁有四個指回同一個死掉的 id，
    // 使用者每按一次就再撞一次 404。
    expect(navDeviceId('/d/99999', 1, KNOWN)).toBe(1)
    expect(navDeviceId('/d/99999/water', 2, KNOWN)).toBe(2)
  })

  it('一台設備都沒有時退回 null（呼叫端會導去設定頁）', () => {
    expect(navDeviceId('/d/99999', null, [])).toBeNull()
  })

  it('停用的設備仍然走網址 —— 判準是「存在」不是「啟用中」', () => {
    // 停用只是不出現在切換器與首頁，舊連結仍要能打開來查歷史。
    // 若這裡改用啟用清單判斷，停用設備的分頁會全部跳到別台去。
    expect(navDeviceId('/d/3/report', 1, KNOWN)).toBe(3)
  })
})
