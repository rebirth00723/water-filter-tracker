import { existsSync, rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const TEST_DB = './data/devices-test.sqlite3'
process.env.DATABASE_PATH = TEST_DB

/** 由測試控制的 cookie 值。resolveDeviceId 只讀這一個 cookie */
let cookieValue: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'wft_last_device' && cookieValue !== undefined
        ? { name, value: cookieValue }
        : undefined,
  }),
}))

const cleanup = () => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(f)) rmSync(f)
  }
}

let db: typeof import('./db').db
let s: typeof import('./db/schema')
let devices: typeof import('./devices')

let first: number
let second: number
let disabled: number

beforeAll(async () => {
  cleanup()
  db = (await import('./db')).db
  s = await import('./db/schema')
  ;(await import('./db/migrate')).runMigrations()
  devices = await import('./devices')

  first = db.insert(s.devices).values({ name: '第一台', sort: 0 }).returning().get().id
  second = db.insert(s.devices).values({ name: '第二台', sort: 1 }).returning().get().id
  disabled = db
    .insert(s.devices)
    .values({ name: '停用的', sort: 2, active: false })
    .returning()
    .get().id
})

afterAll(cleanup)

describe('resolveDeviceId', () => {
  it('沒有 cookie 時用第一台啟用中的設備', async () => {
    cookieValue = undefined
    expect(await devices.resolveDeviceId()).toBe(first)
  })

  it('有 cookie 且指向啟用中的設備時採用它', async () => {
    cookieValue = String(second)
    expect(await devices.resolveDeviceId()).toBe(second)
  })

  it('cookie 指向停用的設備時退回第一台', async () => {
    // 停用之後首頁不該再導到那一台，否則使用者會停在一個「已經不用了」的機器上
    cookieValue = String(disabled)
    expect(await devices.resolveDeviceId()).toBe(first)
  })

  it('cookie 指向不存在的設備時退回第一台', async () => {
    // 這是刪掉設備之後最常見的情況：舊 cookie 會讓首頁導向一個 404
    cookieValue = '99999'
    expect(await devices.resolveDeviceId()).toBe(first)
  })

  it('cookie 是垃圾值時退回第一台而不是拋錯', async () => {
    for (const v of ['abc', '', '1.5', '-1', 'NaN', '1e999']) {
      cookieValue = v
      expect(await devices.resolveDeviceId()).toBe(first)
    }
  })

  it('一台啟用中的設備都沒有時回 null', async () => {
    cookieValue = String(first)
    db.update(s.devices).set({ active: false }).run()
    expect(await devices.resolveDeviceId()).toBeNull()
    db.update(s.devices).set({ active: true }).run()
    db.update(s.devices).set({ active: false }).where(eq(s.devices.id, disabled)).run()
  })
})

describe('listActiveDevices', () => {
  it('排除停用的，並依 sort 排序', () => {
    const list = devices.listActiveDevices()
    expect(list.map((d) => d.name)).toEqual(['第一台', '第二台'])
  })

  it('listDevices 包含停用的', () => {
    expect(devices.listDevices()).toHaveLength(3)
  })
})
