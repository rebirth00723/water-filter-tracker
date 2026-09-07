'use server'

import { and, eq, inArray } from 'drizzle-orm'
import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { categories, devices, items } from '@/lib/db/schema'
import { getDevice } from '@/lib/devices'
import { ActionError, authedAction } from '@/lib/safe-action'
import {
  createCategory,
  createDevice,
  createItem,
  categoryRef,
  deviceRef,
  itemRef,
  reorderCategories,
  reorderDevices,
  updateCategory,
  updateDevice,
  updateItem,
} from '@/lib/schemas/settings'
import {
  categoryItemCount,
  categoryNameTaken,
  categoryUsage,
  deviceHistoryCount,
  getCategory,
  getItem,
  itemNameTaken,
  itemUsage,
  nextCategorySort,
  nextDeviceSort,
} from '@/lib/settings-store'

/**
 * 寫入之後讓畫面反映新狀態。
 *
 * 用 `refresh()`（Next 16）而不是 `revalidatePath`：這些頁面全都是
 * `force-dynamic`，沒有任何資料快取可以失效 —— 唯一需要更新的是客戶端的
 * router，而那正好是 `refresh()` 的職責。
 *
 * 其他路徑不需要顯式處理：`staleTimes.dynamic` 預設為 0，所以動態路由
 * 不會從客戶端快取重用，使用者導覽過去時本來就會在伺服器上重新渲染一次。
 * 因此改一個設備名稱，別頁的設備切換器下次進去自然就是新的。
 */
function revalidateAll() {
  refresh()
}

/** 種類與耗材都掛在設備底下，改動它們也要讓該設備的頁面重新渲染 */
function requireDevice(deviceId: number) {
  const device = getDevice(deviceId)
  if (!device) throw new ActionError('找不到這台設備，可能已經被刪除')
  return device
}

// ───────────────────────────── 設備 ─────────────────────────────

export const addDevice = authedAction
  .metadata({ name: 'device.create' })
  .inputSchema(createDevice)
  .action(async ({ parsedInput, ctx }) => {
    const row = db
      .insert(devices)
      .values({ ...parsedInput, sort: nextDeviceSort() })
      .returning()
      .get()

    ctx.audit({
      entity: 'device',
      entityId: row.id,
      summary: `新增設備「${row.name}」`,
      after: row,
    })
    revalidateAll()
    return { id: row.id, name: row.name }
  })

export const editDevice = authedAction
  .metadata({ name: 'device.update' })
  .inputSchema(updateDevice)
  .action(async ({ parsedInput: { id, ...fields }, ctx }) => {
    const before = requireDevice(id)
    const after = db
      .update(devices)
      .set({ ...fields, updatedAt: Date.now() })
      .where(eq(devices.id, id))
      .returning()
      .get()

    ctx.audit({
      entity: 'device',
      entityId: id,
      summary: `修改設備「${after.name}」`,
      before,
      after,
    })
    revalidateAll()
    return { id, name: after.name }
  })

export const removeDevice = authedAction
  .metadata({ name: 'device.delete' })
  .inputSchema(deviceRef)
  .action(async ({ parsedInput: { id }, ctx }) => {
    const before = requireDevice(id)

    /*
     * 刪設備會 cascade 掉種類、耗材、事件、明細與水質紀錄 ——
     * 那台機器的全部歷史。有任何歷史就不給硬刪，只能停用。
     *
     * 這條規則刻意比外鍵約束更嚴：cascade 會「成功」地把資料刪光，
     * 不像 restrict 會擋下來，所以擋在這裡是唯一的機會。
     */
    const history = deviceHistoryCount(id)
    if (history.events > 0 || history.readings > 0) {
      throw new ActionError(
        `「${before.name}」已經有 ${history.events} 筆耗材紀錄與 ${history.readings} 筆水質紀錄。` +
          `刪除會一併清空這些歷史，因此不允許 —— 請改為「停用」，資料會保留但不再出現在日常畫面。`,
      )
    }

    db.delete(devices).where(eq(devices.id, id)).run()

    ctx.audit({
      entity: 'device',
      entityId: id,
      summary: `刪除設備「${before.name}」`,
      before,
    })
    revalidateAll()
    return { name: before.name }
  })

export const sortDevices = authedAction
  .metadata({ name: 'device.reorder' })
  .inputSchema(reorderDevices)
  .action(async ({ parsedInput: { ids }, ctx }) => {
    // 一次送整份順序而不是「上移一格」：後者在兩個分頁同時操作時會互相蓋掉
    db.transaction((tx) => {
      ids.forEach((id, i) => {
        tx.update(devices).set({ sort: i, updatedAt: Date.now() }).where(eq(devices.id, id)).run()
      })
    })

    ctx.audit({ entity: 'device', summary: `調整設備順序（${ids.length} 台）` })
    revalidateAll()
    return { count: ids.length }
  })

// ───────────────────────────── 種類 ─────────────────────────────

export const addCategory = authedAction
  .metadata({ name: 'category.create' })
  .inputSchema(createCategory)
  .action(async ({ parsedInput, ctx }) => {
    const device = requireDevice(parsedInput.deviceId)
    if (categoryNameTaken(parsedInput.deviceId, parsedInput.name)) {
      throw new ActionError(`「${device.name}」底下已經有叫「${parsedInput.name}」的種類了`)
    }

    const row = db
      .insert(categories)
      .values({ ...parsedInput, sort: nextCategorySort(parsedInput.deviceId) })
      .returning()
      .get()

    ctx.audit({
      entity: 'category',
      entityId: row.id,
      summary: `在「${device.name}」新增種類「${row.name}」`,
      after: row,
    })
    revalidateAll()
    return { id: row.id, name: row.name }
  })

export const editCategory = authedAction
  .metadata({ name: 'category.update' })
  .inputSchema(updateCategory)
  .action(async ({ parsedInput: { id, ...fields }, ctx }) => {
    const before = getCategory(id)
    if (!before) throw new ActionError('找不到這個種類，可能已經被刪除')

    if (fields.name !== before.name && categoryNameTaken(before.deviceId, fields.name, id)) {
      throw new ActionError(`這台設備底下已經有叫「${fields.name}」的種類了`)
    }

    /*
     * 週期是活的，不做快照。改了週期就立刻重算所有未來的到期日 ——
     * 那正是使用者編輯這個欄位時想要的效果，所以這裡什麼都不用多做。
     */
    const after = db
      .update(categories)
      .set({ ...fields, updatedAt: Date.now() })
      .where(eq(categories.id, id))
      .returning()
      .get()

    ctx.audit({
      entity: 'category',
      entityId: id,
      summary: `修改種類「${after.name}」`,
      before,
      after,
    })
    revalidateAll()
    return { id, name: after.name }
  })

export const removeCategory = authedAction
  .metadata({ name: 'category.delete' })
  .inputSchema(categoryRef)
  .action(async ({ parsedInput: { id }, ctx }) => {
    const before = getCategory(id)
    if (!before) throw new ActionError('找不到這個種類，可能已經被刪除')

    // event_items.category_id 是 restrict —— 先問清楚，錯誤訊息才能講人話
    const used = categoryUsage(id)
    if (used > 0) {
      throw new ActionError(
        `「${before.name}」已經出現在 ${used} 筆更換或新購紀錄裡，不能刪除` +
          ` —— 否則那些歷史紀錄會失去它們的種類。請改為「停用」，它就不再出現在挑選器與泳道上。`,
      )
    }

    const cascaded = categoryItemCount(id)
    db.delete(categories).where(eq(categories.id, id)).run()

    ctx.audit({
      entity: 'category',
      entityId: id,
      summary:
        cascaded > 0
          ? `刪除種類「${before.name}」，連帶刪除底下 ${cascaded} 項耗材`
          : `刪除種類「${before.name}」`,
      before,
    })
    revalidateAll()
    return { name: before.name, cascadedItems: cascaded }
  })

export const sortCategories = authedAction
  .metadata({ name: 'category.reorder' })
  .inputSchema(reorderCategories)
  .action(async ({ parsedInput: { deviceId, ids }, ctx }) => {
    const device = requireDevice(deviceId)

    /*
     * 只更新真的屬於這台設備的種類。
     * `deviceId` 與 `ids` 都來自客戶端，各自合法但組合起來未必屬於同一台設備 ——
     * schema 驗的是形狀，擋不住這種「形狀正確但關係不對」的輸入。
     */
    const owned = db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.deviceId, deviceId))
      .all()
      .map((r) => r.id)
    const ordered = ids.filter((id) => owned.includes(id))
    if (ordered.length !== ids.length) {
      throw new ActionError('排序清單裡有不屬於這台設備的種類，已拒絕')
    }

    db.transaction((tx) => {
      ordered.forEach((id, i) => {
        tx.update(categories)
          .set({ sort: i, updatedAt: Date.now() })
          .where(eq(categories.id, id))
          .run()
      })
    })

    ctx.audit({
      entity: 'category',
      summary: `調整「${device.name}」的種類順序（${ordered.length} 項）`,
    })
    revalidateAll()
    return { count: ordered.length }
  })

/**
 * 啟用第二三道這種合併種類時，一併停用被它涵蓋的第二道與第三道。
 *
 * `coversStages` 只用在這一件事上，**刻意不做覆蓋關係的圖遍歷** ——
 * 那會讓「換第二三道要點亮幾條泳道」變成無解的歧義。
 */
export const deactivateCovered = authedAction
  .metadata({ name: 'category.deactivateCovered' })
  .inputSchema(categoryRef)
  .action(async ({ parsedInput: { id }, ctx }) => {
    const cat = getCategory(id)
    if (!cat) throw new ActionError('找不到這個種類，可能已經被刪除')

    const covered = cat.coversStages.split(',').map((s) => s.trim()).filter(Boolean)
    if (covered.length === 0) return { count: 0, names: [] as string[] }

    const targets = db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(
        and(
          eq(categories.deviceId, cat.deviceId),
          inArray(categories.stageKey, covered),
          eq(categories.active, true),
        ),
      )
      .all()
    if (targets.length === 0) return { count: 0, names: [] as string[] }

    db.update(categories)
      .set({ active: false, updatedAt: Date.now() })
      .where(inArray(categories.id, targets.map((t) => t.id)))
      .run()

    const names = targets.map((t) => t.name)
    ctx.audit({
      entity: 'category',
      entityId: id,
      summary: `啟用「${cat.name}」，一併停用被涵蓋的${names.join('、')}`,
    })
    revalidateAll()
    return { count: names.length, names }
  })

// ───────────────────────────── 耗材 ─────────────────────────────

export const addItem = authedAction
  .metadata({ name: 'item.create' })
  .inputSchema(createItem)
  .action(async ({ parsedInput, ctx }) => {
    const cat = getCategory(parsedInput.categoryId)
    if (!cat) throw new ActionError('找不到這個種類，可能已經被刪除')
    if (itemNameTaken(parsedInput.categoryId, parsedInput.name)) {
      throw new ActionError(`「${cat.name}」底下已經有叫「${parsedInput.name}」的耗材了`)
    }

    const row = db.insert(items).values(parsedInput).returning().get()

    ctx.audit({
      entity: 'item',
      entityId: row.id,
      summary: `在「${cat.name}」新增耗材「${row.name}」`,
      after: row,
    })
    revalidateAll()
    // 回傳 id 讓更換表單裡的「就地新增」可以立刻選用它
    return { id: row.id, name: row.name, categoryId: cat.id }
  })

export const editItem = authedAction
  .metadata({ name: 'item.update' })
  .inputSchema(updateItem)
  .action(async ({ parsedInput: { id, ...fields }, ctx }) => {
    const before = getItem(id)
    if (!before) throw new ActionError('找不到這項耗材，可能已經被刪除')

    if (fields.name !== before.name && itemNameTaken(before.categoryId, fields.name, id)) {
      throw new ActionError(`這個種類底下已經有叫「${fields.name}」的耗材了`)
    }

    const after = db
      .update(items)
      .set({ ...fields, updatedAt: Date.now() })
      .where(eq(items.id, id))
      .returning()
      .get()

    ctx.audit({
      entity: 'item',
      entityId: id,
      summary: `修改耗材「${after.name}」`,
      before,
      after,
    })
    revalidateAll()
    return { id, name: after.name }
  })

export const removeItem = authedAction
  .metadata({ name: 'item.delete' })
  .inputSchema(itemRef)
  .action(async ({ parsedInput: { id }, ctx }) => {
    const before = getItem(id)
    if (!before) throw new ActionError('找不到這項耗材，可能已經被刪除')

    const used = itemUsage(id)
    if (used > 0) {
      throw new ActionError(
        `「${before.name}」已經出現在 ${used} 筆紀錄裡，不能刪除` +
          ` —— 否則那些紀錄會失去它們的耗材。請改為「停用」，它就不再出現在挑選器裡。`,
      )
    }

    db.delete(items).where(eq(items.id, id)).run()

    ctx.audit({
      entity: 'item',
      entityId: id,
      summary: `刪除耗材「${before.name}」`,
      before,
    })
    revalidateAll()
    return { name: before.name }
  })
