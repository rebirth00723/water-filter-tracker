import { describe, expect, it } from 'vitest'
import { deviceIdFromPath, devicePath, swapDeviceInPath } from './device-path'

describe('deviceIdFromPath', () => {
  it('認得設備首頁與各分頁', () => {
    expect(deviceIdFromPath('/d/1')).toBe(1)
    expect(deviceIdFromPath('/d/1/')).toBe(1)
    expect(deviceIdFromPath('/d/42/water')).toBe(42)
    expect(deviceIdFromPath('/d/7/consumables/new')).toBe(7)
  })

  it('不是設備路徑就回 null', () => {
    expect(deviceIdFromPath('/')).toBeNull()
    expect(deviceIdFromPath('/settings')).toBeNull()
    expect(deviceIdFromPath('/settings/devices/3')).toBeNull()
    expect(deviceIdFromPath('/dashboard')).toBeNull()
  })

  it('拒絕不是正整數的 id', () => {
    // 這些都是使用者手改網址或舊書籤會產生的東西
    expect(deviceIdFromPath('/d/0')).toBeNull()
    expect(deviceIdFromPath('/d/abc')).toBeNull()
    expect(deviceIdFromPath('/d/1.5')).toBeNull()
    expect(deviceIdFromPath('/d/-1')).toBeNull()
    expect(deviceIdFromPath('/d/')).toBeNull()
  })

  it('拒絕超出安全整數範圍的 id', () => {
    // Number('99999999999999999999') 會變成不精確的浮點數，
    // 拿去查資料庫會查到別筆或查不到，兩者都不該發生
    expect(deviceIdFromPath('/d/99999999999999999999')).toBeNull()
  })

  it('前綴相同但不是設備路徑的不算', () => {
    expect(deviceIdFromPath('/data/1')).toBeNull()
    expect(deviceIdFromPath('/d1/2')).toBeNull()
  })
})

describe('swapDeviceInPath', () => {
  it('換設備但停在同一個分頁', () => {
    expect(swapDeviceInPath('/d/1/water', 2)).toBe('/d/2/water')
    expect(swapDeviceInPath('/d/1/consumables/new', 5)).toBe('/d/5/consumables/new')
  })

  it('設備首頁換過去還是首頁', () => {
    expect(swapDeviceInPath('/d/1', 2)).toBe('/d/2')
    expect(swapDeviceInPath('/d/1/', 2)).toBe('/d/2/')
  })

  it('不在設備路徑上時退回該設備首頁', () => {
    // 例如從設定頁按切換器（實際上不會發生，但不該產生壞網址）
    expect(swapDeviceInPath('/settings', 3)).toBe('/d/3')
  })
})

describe('devicePath', () => {
  it('組出設備底下的分頁路徑', () => {
    expect(devicePath(1)).toBe('/d/1')
    expect(devicePath(1, '')).toBe('/d/1')
    expect(devicePath(1, 'water')).toBe('/d/1/water')
  })
})
