import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * 日期慣例：使用者可見的日期存 TEXT『YYYY-MM-DD』；
 * 只有真實時間點（createdAt / sentAt / at）存 epoch ms 的 INTEGER。
 */

export const EVENT_TYPES = ['PURCHASE', 'REPLACE', 'ADJUST'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const READING_SOURCES = ['MANUAL', 'REPLACE'] as const
export type ReadingSource = (typeof READING_SOURCES)[number]

export const CYCLE_UNITS = ['DAY', 'MONTH'] as const
export type CycleUnit = (typeof CYCLE_UNITS)[number]

const now = () => Date.now()

// ───────────────────────────── 設備 ─────────────────────────────
export const devices = sqliteTable(
  'devices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    model: text('model'),
    /** 起算日備援 #3 */
    installedOn: text('installed_on'),
    /** 留空＝沿用全域 topic */
    ntfyTopic: text('ntfy_topic'),
    sort: integer('sort').notNull().default(0),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (t) => [index('dev_idx').on(t.active, t.sort)],
)

// ───────────────────────────── 種類 ─────────────────────────────
export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deviceId: integer('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** 泳道圓點顏色，刻意避開圖表的橘（原水）與藍（純水） */
    color: text('color').notNull(),
    sort: integer('sort').notNull().default(0),
    /** null＝不設更換週期 */
    cyclePeriod: integer('cycle_period'),
    cycleUnit: text('cycle_unit').$type<CycleUnit>().notNull().default('MONTH'),
    /** 起算日備援 #2：「裝機時就換過」 */
    baselineOn: text('baseline_on'),
    /** s1|s2|s3|s2s3|ro|s5|s6 */
    stageKey: text('stage_key'),
    /** 第二三道＝"s2,s3"。僅用於啟用時提示要不要停用被涵蓋的種類 */
    coversStages: text('covers_stages').notNull().default(''),
    notifyEnabled: integer('notify_enabled', { mode: 'boolean' }).notNull().default(true),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex('cat_device_name_uq').on(t.deviceId, t.name),
    index('cat_idx').on(t.deviceId, t.active, t.sort),
  ],
)

// ───────────────────────────── 耗材 ─────────────────────────────
export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    brand: text('brand'),
    defaultQty: integer('default_qty').notNull().default(1),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex('item_category_name_uq').on(t.categoryId, t.name),
    index('item_idx').on(t.categoryId, t.active),
  ],
)

// ──────────────────── 事件（新購 / 更換 / 盤點）────────────────────
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deviceId: integer('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    type: text('type').$type<EventType>().notNull(),
    occurredOn: text('occurred_on').notNull(),
    /** 購買來源：店家名稱或連結，僅 PURCHASE 使用 */
    vendor: text('vendor'),
    note: text('note'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (t) => [
    index('ev_device_type_on').on(t.deviceId, t.type, t.occurredOn),
    index('ev_device_on').on(t.deviceId, t.occurredOn),
  ],
)

export const eventItems = sqliteTable(
  'event_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    /** restrict：有歷史的耗材禁止硬刪，只能停用 */
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    /** 快照：耗材日後若搬到別的種類，歷史紀錄不可跟著改寫 */
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    /** ADJUST 可為負 */
    qty: integer('qty').notNull(),
    /** 單價（新台幣元），僅 PURCHASE 使用 */
    unitPrice: integer('unit_price'),
  },
  (t) => [
    uniqueIndex('ei_event_item_uq').on(t.eventId, t.itemId),
    index('ei_category').on(t.categoryId, t.eventId),
    index('ei_item').on(t.itemId),
  ],
)

// ───────────────────────────── 水質 ─────────────────────────────
export const readings = sqliteTable(
  'readings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deviceId: integer('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    measuredOn: text('measured_on').notNull(),
    rawPpm: integer('raw_ppm').notNull(),
    purePpm: integer('pure_ppm').notNull(),
    source: text('source').$type<ReadingSource>().notNull().default('MANUAL'),
    /** 有值＝這筆 PPM 由該更換事件擁有，隨事件一起更新與刪除 */
    eventId: integer('event_id')
      .unique()
      .references(() => events.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  // 刻意不 unique：更換當天可以有例行量測與換後量測兩筆
  (t) => [index('rd_device_on').on(t.deviceId, t.measuredOn)],
)

// ───────────────────────────── 通知 ─────────────────────────────
export const NOTIFY_RULE_KINDS = ['ADVANCE', 'OVERDUE'] as const
export type NotifyRuleKind = (typeof NOTIFY_RULE_KINDS)[number]

export const notifyRules = sqliteTable('notify_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').$type<NotifyRuleKind>().notNull(),
  /** ADVANCE：提前幾天（14 / 3 / 0） */
  offsetDays: integer('offset_days'),
  /** OVERDUE：逾期後每幾天重發一次 */
  repeatDays: integer('repeat_days'),
  template: text('template').notNull(),
  /** ntfy 1-5 */
  priority: integer('priority').notNull().default(3),
  /**
   * 這條規則的發送時刻（HH:MM）。留空＝沿用 settings['notify.sendTime']。
   *
   * 逐條可設的理由：「當天到期」的提醒你會想在出門前看到，
   * 而「14 天前」的那則什麼時候送都無所謂 —— 綁在同一個時刻會讓前者失去意義。
   */
  sendTime: text('send_time'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().$defaultFn(now),
})

export const NOTIFY_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number]

export const notifyLog = sqliteTable(
  'notify_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ruleId: integer('rule_id')
      .notNull()
      .references(() => notifyRules.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** 實際送出的 topic */
    target: text('target').notNull(),
    /** ADVANCE 存到期日；OVERDUE 存「送出當日」，讓每次重複各佔一列 */
    dueOn: text('due_on').notNull(),
    kind: text('kind').notNull(),
    status: text('status').$type<NotifyStatus>().notNull(),
    /**
     * 規劃當下算出來的天數（ADVANCE 是剩餘、OVERDUE 是已逾期）。
     *
     * 存下來是為了重試時**不重算** —— 重算用的是「現在的到期狀態」，
     * 而那在使用者換了濾心或改了週期之後就變了，
     * 於是重試會送出一則數字完全對不上的訊息。
     * 訊息的內容應該是它被規劃的那一刻的樣子。
     */
    plannedDays: integer('planned_days'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    claimedAt: integer('claimed_at').notNull().$defaultFn(now),
    sentAt: integer('sent_at'),
    ntfyId: text('ntfy_id'),
  },
  (t) => [
    // 冪等鍵：cron 重跑不會重複送出
    uniqueIndex('nl_uq').on(t.ruleId, t.categoryId, t.dueOn, t.kind),
    index('nl_retry').on(t.status, t.claimedAt),
  ],
)

// ───────────────────────── 稽核與設定 ─────────────────────────
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull().$defaultFn(now),
    username: text('username'),
    /** CF-Connecting-IP，僅記錄用途，不參與限流 */
    ip: text('ip'),
    userAgent: text('user_agent'),
    /** login.ok / login.fail / login.locked / event.create ... */
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: integer('entity_id'),
    /** 中文摘要，可直接顯示 */
    summary: text('summary').notNull(),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
  },
  (t) => [index('al_at').on(t.at), index('al_action_at').on(t.action, t.at)],
)

export const settings = sqliteTable('settings', {
  /** notify.sendTime / ntfy.topic / audit.keepDays / ui.defaultDeviceId */
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
})

/**
 * 登入狀態。限流計數器刻意只放記憶體（重啟即解鎖），
 * 但密碼雜湊與 session 版本必須持久化。
 */
export const authState = sqliteTable('auth_state', {
  username: text('username').primaryKey(),
  /** scrypt$N$r$p$salt$hash。「無密碼」模式下為 null */
  passwordHash: text('password_hash'),
  /** 以臨時密碼登入後為 true，在改完密碼前擋住其他功能 */
  mustChangePassword: integer('must_change_password', { mode: 'boolean' })
    .notNull()
    .default(false),
  /** 遞增即可讓所有已簽發的 session 失效（登出所有裝置） */
  tokenVersion: integer('token_version').notNull().default(1),
  lastLoginAt: integer('last_login_at'),
})

/**
 * passkey 公鑰。伺服器只存公鑰 —— 資料庫外洩也無法用來登入，
 * 這與共享密鑰式的驗證方式是根本差異。
 *
 * 每一筆憑證就是一台裝置，因此不需要另一張「已知裝置」表。
 */
export const credentials = sqliteTable(
  'credentials',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    /** base64url */
    credentialId: text('credential_id').notNull().unique(),
    /** base64url */
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    /** JSON array，例如 ["internal","hybrid"] */
    transports: text('transports'),
    /** 使用者自訂名稱，方便在清單裡辨識與刪除 */
    deviceLabel: text('device_label'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => [index('cred_username').on(t.username)],
)

/**
 * 機器組態：ntfy 連線、對外網址等「這台機器怎麼接外面」的設定。
 *
 * 與 settings 分開的理由是**匯出範圍** —— settings 會被 JSON 匯出帶走，
 * 而這裡放的是憑證與站台專屬值，匯出去只會變成外洩。
 */
export const machineConfig = sqliteTable('machine_config', {
  /** publicUrl / ntfy.url / ntfy.topicFilter / ntfy.topicSecurity / ntfy.token / passkey.enabled */
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
})
