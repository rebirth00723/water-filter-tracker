/**
 * 操作紀錄的分類，**刻意不匯入資料庫** ——
 * 篩選器是 Client Component，而 `audit-store.ts` 帶著 `server-only` 與 db。
 *
 * 這是第三次遇到同一個形狀（device-path、ppm、這裡）：
 * 只要有一份常數或純函式同時給伺服端與客戶端用，它就該住在自己的模組裡。
 */

/**
 * 所有動作名稱的前綴。
 *
 * **做成型別而不只是執行期的清單**：`AuditEntry.action` 收窄成
 * `Prefix | \`${Prefix}.${string}\``，於是新增一個沒有對應分類的動作
 * **編譯就會失敗**。
 *
 * 這條規則是修一個真 bug 時加的：`logout` 與 `password.change` 兩個動作
 * 因為前綴清單寫成 `'login.'`（帶點）而配不到任何分類，
 * 在操作紀錄頁上就少了徽章 —— 而那種缺漏只有一個一個看才會發現。
 */
const PREFIXES = [
  'login',
  'logout',
  'setup',
  'password',
  'passkey',
  'admin',
  'event',
  'reading',
  'device',
  'category',
  'item',
  'notifyRule',
  'notifyPrefs',
  'notify',
  'data',
] as const

export type AuditPrefix = (typeof PREFIXES)[number]

/** 動作名稱：前綴本身，或前綴加點再接任意細分（login.ok、login.fail.locked） */
export type AuditAction = AuditPrefix | `${AuditPrefix}.${string}`

export const AUDIT_GROUPS = {
  login: {
    label: '登入與安全',
    prefixes: ['login', 'logout', 'setup', 'password', 'passkey', 'admin'],
  },
  event: { label: '耗材紀錄', prefixes: ['event'] },
  reading: { label: '水質紀錄', prefixes: ['reading'] },
  config: {
    label: '設定',
    prefixes: ['device', 'category', 'item', 'notifyRule', 'notifyPrefs'],
  },
  data: { label: '匯出與匯入', prefixes: ['data'] },
  notify: { label: '通知', prefixes: ['notify'] },
} as const satisfies Record<string, { label: string; prefixes: readonly AuditPrefix[] }>

export type AuditGroup = keyof typeof AUDIT_GROUPS

/**
 * 判斷一筆紀錄屬於哪個分類（顯示徽章用）。
 *
 * 比對「前綴本身」或「前綴 + 點」，不用單純的 startsWith ——
 * 否則 `notifyRule.create` 會先被 `notify` 抓走而歸到「通知」分類，
 * 而它其實是設定變更。順序相依的比對遲早會被人重排壞掉。
 */
export function groupOf(action: string): AuditGroup | null {
  for (const [key, g] of Object.entries(AUDIT_GROUPS)) {
    for (const p of g.prefixes as readonly string[]) {
      if (action === p || action.startsWith(`${p}.`)) return key as AuditGroup
    }
  }
  return null
}

/** 舊資料或未來新增但忘了分類的動作，統一顯示成這個 */
export const UNGROUPED_LABEL = '其他'
