# 淨水器耗材與水質記錄系統 — 實作指示

> 本文件是給 Claude Code 的執行指示，不是給人看的簡報。讀完後直接照「建置順序」逐階段實作，
> 每階段結束都要跑一次「驗證方式」對應項目再進下一階段。遇到本文件沒覆蓋到的細節，
> 優先延續「決策摘要」與各節「理由」段落背後的判斷邏輯，不要引入新假設；
> 無法判斷時停下來問，不要用猜的往下走。

## 開始前必須先決定的事（人工確認，不要自行假設）

這一點在原始規劃稿裡有矛盾，已經修正，但需要你（開發者）明確回答一次：

1. **Cloudflare Access 是否要保留？** 目前 repo 有 `src/lib/auth/cf-access.ts`、
   `CF_ACCESS_TEAM_DOMAIN`／`CF_ACCESS_AUD`，是現行的第二道關卡。本計畫預設**移除**它，
   理由是開源專案不該綁定單一廠商的驗證機制，密碼＋passkey 已經是完整的存取控制。
   若確認移除：連同 `cf-access.ts`、相關 import、環境變數一併刪除，不要留 dead code。

## 已確認的決策（補充）

- **無密碼模式下如何補設密碼**：可直接在 `/admin` 啟用密碼設定，不需要先有 session——
  這個模式下 `/admin` 本身就是信任邊界（無密碼模式本來就沒有登入層），不是漏洞，是刻意
  留的補救路。細節見「初始化」一節。
- **啟用 passkey 後，使用者在哪裡設定「快速登入」**：拆成兩層，admin 只管全域開關與緊急
  撤銷，日常的自助註冊在 app 一般設定頁。細節見「登入與存取控制 → passkey」一節。
- **設備專屬 QR（`/d/<deviceId>` 連結）與 passkey 註冊是兩件不相關的事**，原始稿裡
  「填對外網址 → 產生註冊 QR」這句話已刪除（對應的是已廢除的 token 註冊流程）。設備 QR
  功能保留在「設備設定頁內建 QR Code 產生器」一節，與登入無關。

---

## Context

家中有 RO 淨水器（未來可能不只一台），濾心更換時間與水質變化目前靠記憶，容易忘記更換，
也看不出濾心衰退趨勢。要做一套**自架、手機優先、單人使用**的記錄系統：記錄耗材新購／更換與成本、
記錄原水與純水 PPM、把兩者疊在同一條時間軸上判斷濾心衰退，並在接近更換日時透過 ntfy 主動推播。

現況：`/Users/rose/Desktop/code`，階段 0（骨架）已完成並通過驗證；階段 1 原以 TOTP 實作、通過 47
項測試，**依下方「登入與存取控制」需整段改寫為密碼＋passkey**（`ratelimit.ts`／`session.ts`／
`store.ts`／`audit` 可沿用邏輯，`ratelimit` 因為密碼可暴力破解而重新變成核心，TOTP 相關程式碼移除）。
現有 `src/lib/db/schema.ts` **沒有** `credentials` 表、**沒有** `machine_config` 表，兩者都要新增。
開發機：Node v22.20.0、npm 10.9.3、Docker 29.5.2。

## 不可協商的技術決策

| 項目 | 決定 | 理由 |
|---|---|---|
| 框架 | Next.js 16（App Router）+ TypeScript | Next 15 於 2026-10-21 EOL；16 的 `proxy.ts` 只跑 Node runtime，session 驗證不受 Edge 限制 |
| 資料層 | Drizzle ORM + better-sqlite3（不用 Prisma） | Prisma 7 移除 Rust engine、連線設定移到 `prisma.config.ts`，該檔不在 Next standalone 追蹤範圍。Drizzle 的 migration 在 process 內執行，runtime image 不需任何 CLI |
| 圖表 | ECharts 6（`echarts/core` tree-shaken）+ 自寫 hook | 唯一原生支援「多 grid 共用 X 軸 + 跨面板十字準線 + 觸控縮放」的選項 |
| 樣式 | Tailwind v4 + shadcn/ui | |
| 通知 | ntfy JSON 發布端點 | Node 22 的 `fetch` 在 header 放中文會直接 throw，中文標題只能走 JSON body |
| 排程 | `instrumentation.ts` + croner（不開 sidecar） | sidecar 與 app 同機，一起關機、一起錯過，宣稱的「解耦」優勢是假的 |
| 存取控制 | 密碼為地板、passkey 為升級，**單一埠、單一規則** | 授權不看網路位置，不需要任何「這是不是本地」的推論 |
| 對外 | 反向代理／tunnel → 單一埠；不再有第二個埠 | 不假設特定 tunnel 技術。作者環境用既有的 cloudflared，以容器名稱直接路由 |
| 時區 | Asia/Taipei，日期一律存 `YYYY-MM-DD` 字串 | |

## 系統結構

```
cloudflare_tunnel_default（既有的 external 網路）
  ├─ service_proxy (cloudflared，已架設)
  ├─ ntfy          (已架設，內部 http://ntfy:80)
  └─ app           Next 16 standalone
                   croner 排程 → ntfy 推播
                   └→ ./data/app.sqlite3（bind mount 於專案資料夾）
```

- app 加入既有的 `cloudflare_tunnel_default` 網路，**只有一個埠**（`PORT`，預設 8085），
  由 cloudflared 以容器名稱路由。全文只有這一個對外埠，任何提到「管理埠」「註冊中心的埠」
  的敘述都是錯的，不要實作。
- **埠一律 ≥1024**：容器可能以任意非 root uid 執行，舊核心（如 Synology DSM 的 4.4）沒有
  `net.ipv4.ip_unprivileged_port_start`，綁 1024 以下的埠會直接 `EACCES`。預設 8085。
- 不放反向代理。TLS 由 tunnel 或部署者自備的代理終結。
- **來源 IP 只用於稽核記錄，不參與任何授權判定**——授權完全由 session 決定。
  預設依序嘗試 `CF-Connecting-IP` → `X-Forwarded-For` 最右段 → `unknown`；
  可用 `REAL_IP_HEADER` 指定單一 header（Vaultwarden 的 `IP_HEADER`、Gitea、Nextcloud、
  nginx 的 `real_ip_header` 都有同樣的設定）。**這個值設錯只會讓日誌不準，不會變成安全漏洞**。
- cloudflared 的 ingress **不要設 `httpHostHeader`**，那會改寫 Host 而使 Next.js 的
  Server Action origin 檢查失敗。

## 資料模型

`src/lib/db/schema.ts`（Drizzle / SQLite）。所有使用者可見的日期存 `TEXT` 格式
`YYYY-MM-DD`，只有 `createdAt` / `sentAt` 這類真實時間點存 epoch ms。

理由：這些是「日曆上的日期」而非時間點。存成 DateTime 會讓 `2026-09-05T00:00:00Z` 在台北
被算成 09-05 08:00，每個 `slice(0,10)` 都是潛在的差一天。字串版另有三個好處——字典序等於
時序（`MAX()`、`ORDER BY`、`BETWEEN` 直接可用）、跨 Server/Client 邊界不需序列化、
`z.iso.date()` 可精確驗證。

已存在的表（devices / categories / items / events / eventItems / readings / notifyRules /
notifyLog / auditLog / settings）維持現有定義不變，直接沿用目前 `schema.ts` 內容，
不要重寫。以下是需要**新增**或**修改**的部分：

```ts
// 新增：passkey 公鑰。目前 schema.ts 沒有這張表。
export const credentials = sqliteTable('credentials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull(),
  credentialId: text('credential_id').notNull().unique(),   // base64url
  publicKey: text('public_key').notNull(),                  // base64url
  counter: integer('counter').notNull().default(0),
  transports: text('transports'),                           // JSON array
  deviceLabel: text('device_label'),                        // 使用者自訂名稱，方便辨識/刪除
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
}, t => [index('cred_username').on(t.username)])

// 新增：機器組態（ntfy 連線、對外網址等「這台機器怎麼接外面」的設定）。
// 與 settings 分開的理由是匯出範圍——settings 會被匯出，這裡放的是憑證與站台專屬值，
// 匯出去只會變成外洩。
export const machineConfig = sqliteTable('machine_config', {
  key: text('key').primaryKey(),   // publicUrl / ntfy.url / ntfy.topicFilter / ntfy.topicSecurity / ntfy.token / passkey.enabled ...
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// 修改既有 auth_state：新增 passwordHash、mustChangePassword，移除 TOTP 相關欄位（lastTimeStep），
// 保留 tokenVersion（登出所有裝置用）。
export const authState = sqliteTable('auth_state', {
  username: text('username').primaryKey(),
  passwordHash: text('password_hash'),              // scrypt$N$r$p$salt$hash，「無密碼」模式下可為 null
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  tokenVersion: integer('token_version').notNull().default(1),
  lastLoginAt: integer('last_login_at'),
})
```

**移除**：`enrollment_tokens`（若存在）——不再需要一次性註冊 token，passkey 註冊改為
「先密碼登入，再到設定頁註冊」。

**種子資料**：一台預設設備 + 七個種類（第一道、第二道、第三道、第二三道、RO、第五道、第六道），
全部 `active: true`，顏色刻意避開圖表的橘與藍。**不預載任何耗材品項**，由使用者自行新增。

第二道／第三道與合併的第二三道採「各自獨立 + `active` 停用」處理，不做覆蓋關係的圖遍歷。
`coversStages` 只用於一件事：使用者啟用第二三道時提示「要一併停用第二道與第三道嗎？」。

## 核心邏輯

**日期工具 `src/lib/date.ts`（約 50 行，不引入日期函式庫）**：`today()` 用
`Intl.DateTimeFormat('en-CA', { timeZone })` 直接產出 `YYYY-MM-DD`，時區取自 `TZ`；
`addDays` / `diffDays` 走 UTC 午夜的毫秒運算；`addMonths` 需處理月底夾擠（1/31 + 1 月 → 2/28）。
`Intl` 用 Node 內建 ICU，不依賴容器的 tzdata。

**下次更換日——四階梯，新購不算**

| 順序 | 來源 | basis |
|---|---|---|
| 1 | 該種類最後一次 `REPLACE` 事件的 `occurredOn` | `REPLACE` |
| 2 | `categories.baselineOn`（使用者設的起算日） | `BASELINE` |
| 3 | `devices.installedOn` | `DEVICE_INSTALL` |
| 4 | 都沒有 → `null` | `NONE` |

第 4 階必須顯示「尚未設定起算日」並附一鍵「設為今天」，**絕不可以編一個假的到期日**。
另外要單獨呈現的狀態：`庫存 > 0 且 basis !== 'REPLACE'` → 「已購入，尚未更換」。

不做「耗材層級的週期覆寫」，所有到期相關介面以種類為單位。不把週期快照到事件上——
改週期就該立刻重算所有未來到期日。

**庫存**：`SUM(PURCHASE) − SUM(REPLACE) + SUM(ADJUST)`，即時計算不做冗餘欄位。允許負數並
如實顯示（「庫存 −1，可能有未記錄的購入」）。

**成本**：`unitPrice × qty` 加總。報表提供年度耗材支出、各種類累計金額、每道平均月成本；
耗材挑選器上顯示「上次 $NNN · 在 XX 買」。

## 更換事件與水質紀錄的連動

PPM 只存在 `readings` 一張表，`events` 沒有 PPM 欄位。更換事件填的 PPM 寫成一筆
`source='REPLACE'` 且 `eventId` 指回該事件的 reading。

三條寫入路徑（全部包在一個 transaction）：

- **新增**：建 event → 建 eventItems → 有 PPM 才建 reading。
- **編輯**：更新 event → 刪光重建 eventItems → `upsert` reading。`upsert` 的 update 分支
  **一定要一併更新 `measuredOn`**，否則改了事件日期，圖上的點還留在舊位置——這是唯一
  必須寫測試的地方。PPM 被清空則刪除該 reading。
- **刪除**：刪 event，reading 與 eventItems 由 cascade 處理。

**水質紀錄頁對這類 reading 的規則**：PPM 值可就地編輯；日期鎖定，顯示「來自更換紀錄」
標籤並深連結到該事件；不可單獨刪除，改為提供「前往更換紀錄」。

`event_items.categoryId` 是快照，不是冗餘：耗材日後被搬到別的種類，歷史紀錄不可以跟著改寫。
`event_items.itemId` / `categoryId` 用 `restrict`：有歷史的耗材與種類禁止硬刪，只能停用。

## 通知

ntfy 一律 POST 到根路徑的 JSON 端點（不是 `/{topic}`），
`{ topic, title, message, tags, priority, click }`。認證用 `Authorization` header
（`Bearer <token>` 優先，否則 `Basic base64(user:pass)`），**不要用 `?auth=` query param**。

**認證與 topic 存在哪**：優先讀環境變數（`NTFY_TOKEN`，或 `NTFY_USER`+`NTFY_PASSWORD`／
`NTFY_PASSWORD_FILE`）；沒設才讀 `machine_config` 表。`machine_config` 不在匯出範圍內。
資料庫裡是明文，不加密——README 要寫明這件事，不要假裝安全。**建議優先用 token**：
外洩時可單獨撤銷。管理中心不回顯已存的認證值，顯示為遮蔽狀態並提供「更換」動作。

**topic 算不算密碼，取決於 ntfy 伺服器的設定**：開放式伺服器（`auth-default-access:
read-write`）需要隨機後綴；需認證的伺服器（`deny-all`）不需要。README 兩種情況分開寫。

**分成兩個 topic**：`ntfy.topicFilter`（濾心提醒）與 `ntfy.topicSecurity`（憑證與登入事件），
認證共用同一組 token 或帳密。topic 解析順序：`devices.ntfyTopic`（僅濾心提醒可覆寫）
→ `machine_config` → 環境變數。

**排程 = croner 每 15 分鐘掃描 + 開機後 20 秒補掃一次**，不是「每天在設定時刻觸發一次」——
後者在機器剛好沒開機時就整天不送。發送時刻可逐條規則設定（`notify_rules.sendTime`），
留空則沿用全域預設 `settings['notify.sendTime']`。

`instrumentation.ts` 需三重防護避免重複啟動：`NEXT_RUNTIME !== 'nodejs'` 直接 return、
`globalThis` symbol singleton（擋開發模式 HMR）、croner 的 `protect`。動態 import 必須用
靜態字串路徑，否則 standalone 的 file tracing 追不到。

**去重採先佔位再送出（outbox）**：`INSERT OR IGNORE` 到 `notify_log`，影響列數為 0 即代表
送過，直接跳過——不要先 SELECT 再 INSERT，那是 TOCTOU。失敗的列保留為 `failed` 並累加
`attempts`，超過 5 次停止並在設定頁標紅。**去重 key 的 `kind` 維度不可省**：「提前 14 天」
與「當天」是兩則不同通知。

**逾期提醒**：`kind='OVERDUE'` 的規則以 `repeatDays` 控制頻率，`notify_log.dueOn`
存送出當日而非到期日，讓每一次重複各佔一列。

**補送上限**：機器關機超過 `settings['notify.catchupMaxDays']`（預設 14 天）才到期的項目
不逐一補送，改發一則彙總，個別項目以 `skipped` 寫入 notify_log 佔住 key。

### 通知一覽

**濾心相關（排程送出）**

| 通知 | 預設 | 可調 |
|---|---|---|
| 提前提醒 `ADVANCE` | 三條：到期前 14 天、3 天、當天 | 設定頁可增刪，逐條自訂天數、發送時刻、訊息與優先度 |
| 逾期提醒 `OVERDUE` | 逾期後每 7 天一次 | 改頻率或停用 |
| 離線彙總 `digest` | 關機超過補送上限時，一則彙總取代逐項補送 | 補送天數上限可調 |

**安全相關（事件觸發）**

| 事件 | 推播 | 理由 |
|---|---|---|
| 新 passkey 註冊成功 | 是，優先度 4 | 有人多了一把能從外面進來的鑰匙 |
| 憑證被刪除 | 是 | 若不是你做的，代表有人動了存取控制 |
| 一般登入成功 | **否** | 每天登入就每天響，是雜訊——「新裝置」已由「passkey 註冊成功」涵蓋 |

**手動**：設定頁的「傳送測試通知」。送不出去的通知不會再用推播告知，留在 `notify_log`
並在設定頁標紅。

訊息樣板變數：`{device}` `{category}` `{items}` `{days}` `{dueOn}`。錯誤依 `config` /
`auth` / `timeout` / `network` 分類給出可操作的中文訊息。

## 登入與存取控制

密碼是地板，passkey 是升級。授權不看網路位置，所有請求走同一條規則，**只有一個埠**。

### 三種模式

| 模式 | 條件 | 適用 |
|---|---|---|
| 無密碼 | 使用者在初始化時明確選擇不設 | 純區網、不對外 |
| 密碼 | 設了密碼 | 預設 |
| 密碼 + passkey | 另需 `PUBLIC_URL` 為帶網域的 https | 想要免打字的快捷登入 |

**啟用 passkey 就強制要有密碼**，不能只有 passkey——passkey 綁定裝置與網域，裝置遺失、
換網域、或沒有 HTTPS 時都會失效，此時密碼是唯一退路。**密碼在任何連線下都要求輸入，
不因為是 HTTPS 或區網而放寬。**

### 初始化

首次訪問時進入設定流程：設定使用者名稱與密碼，或明確選擇「不設密碼」。**刻意不加保護**
（不需要日誌 token、不設限時視窗）——服務要不要對外由部署者決定，意外暴露不在本設計的
防護範圍內。README 要寫明「請在對外開放之前完成初始化」。

**選擇不設密碼後，事後仍可補設**：`/admin` 在無密碼模式下不要求 session 就能進入密碼
設定畫面——這個模式本來就沒有登入層，`/admin` 本身即為信任邊界。一旦在這裡設了密碼，
系統就從無密碼模式切換成密碼模式，之後所有路由恢復要求 session。這是使用者之後想啟用
passkey（passkey 強制要密碼）時唯一的入口。

### 密碼實作

- 雜湊用 `node:crypto` 的 `scrypt`，每組密碼獨立 salt，儲存為
  `scrypt$N$r$p$salt$hash`，比對用 `timingSafeEqual`。選它而非 Argon2 是因為零原生相依。
- 表單必須能觸發瀏覽器的密碼儲存：真正的 `<form>` 提交（不是純 fetch）、帶
  `autocomplete="username"` 與 `autocomplete="current-password"`（改密碼頁用
  `new-password`）、保留使用者名稱欄位即使只有一個帳號。
- 限流從邊緣角色變回核心。沿用既有 `ratelimit.ts`（30 秒 2 次、累計 4 次鎖 10 分鐘、記憶體式）。

### 臨時密碼（救援）

`TEMP_PASSWORD` 環境變數，避免改了密碼又忘記而完全進不去。

1. 以它登入成功後，強制進入修改密碼流程，完成前無法使用其他功能。
2. 只要 env 裡還留著它，每次登入都顯示提醒——一次性提醒會被忽略，而這個東西留著就是
   永久後門。
3. README 與提醒文案都要直說：用完請從 env 移除並重啟。

比對用 `timingSafeEqual`，同樣受限流保護。

### passkey

- 只有在 `PUBLIC_URL` 是帶網域名稱的 https 時才能啟用（RP ID 不接受 IP）。條件不滿足時，
  admin 的開關顯示為停用並說明原因。
- **管理分兩層，職責不重疊**：
  - **`/admin`**：系統層級的**全域開關**（是否啟用 passkey 這個功能，牽涉 `PUBLIC_URL`
    與 https，是部署層級的決定）；以及**完整憑證清單**，可撤銷任一筆憑證——這是留給
    緊急情況用的（例如手機遺失，要立刻讓那把 passkey 失效），不是日常操作入口。
  - **`(app)/settings/login`（app 一般設定頁，不是 admin）**：admin 開關打開後，
    使用者在這裡自助**註冊「快速登入」**——新增本裝置的 passkey、命名、刪除自己的憑證。
    換裝置、加新瀏覽器都在這裡做，不必跑到 admin。若 admin 尚未啟用 passkey（或
    `PUBLIC_URL` 條件不滿足），這裡顯示原因並附前往 admin 的連結，不是讓人點了才發現
    沒反應。
- **註冊不需要任何 token**：先用密碼登入，再到 `(app)/settings/login` 註冊——密碼登入
  本身就是授權。換裝置時在新裝置上用密碼登入再註冊即可。
- 伺服器只存公鑰；換網域會使既有 passkey 全部失效，需重新註冊。

### 單一埠與子路徑

對外只有一個埠（`PORT`，預設 8085），Next standalone 直接監聽，**不再有第二個埠、
不再有轉發器**。

`/admin` 若與同網域上的其他服務撞路徑，可用 `BASE_PATH` 把整個 App 掛在子路徑下
（Next.js 的 `basePath`），例如 `BASE_PATH=/water` 之後管理頁是 `/water/admin`
（Grafana 的 `root_url` 同一個思路）。設了 `BASE_PATH` 時 `PUBLIC_URL` 也要含該前綴，
否則 passkey 的來源比對與 QR Code 連結都會錯。

### 資料表異動（對照現行 TOTP 版）

- 移除 `enrollment_tokens`（若存在）。
- `auth_state` 移除 TOTP 相關欄位、新增 `passwordHash`、`mustChangePassword`，保留 `tokenVersion`。
- **新增** `credentials` 表（passkey 公鑰）——現行 schema 沒有這張表。
- **新增** `machine_config` 表。
- 移除 `cf-access.ts` 與 `CF_ACCESS_TEAM_DOMAIN`／`CF_ACCESS_AUD`（見「開始前必須先決定的事」#1）。

## 安全加固

不做 HSTS：一旦送出長 `max-age` 就不可逆，會把純 HTTP 自架的人鎖死。

| 項目 | 內容 |
|---|---|
| CSP（nonce 式） | 在 `proxy.ts` 產生 per-request nonce |
| frame-ancestors `'none'` | 防點擊劫持 |
| Referrer-Policy | `strict-origin-when-cross-origin`，`/register` 另用 `no-referrer` |
| Origin / Sec-Fetch-Site | 所有寫入操作都檢查，擋掉瀏覽器發起的跨站寫入 |
| Dependabot + `npm audit` | 相依套件漏洞掃描 |

## 稽核與日誌

訪問紀錄由 app 在 `src/proxy.ts` 自己寫（方法、路徑、真實 IP、User-Agent、是否已認證），
走既有結構化 JSON 日誌。proxy 在回應產生前執行，拿不到狀態碼與耗時——有反向代理／tunnel
的人可從那一層取得完整 access log。

操作紀錄寫 `audit_log`，包在所有寫入操作的共用外層（`next-safe-action` 的 middleware）。
記錄登入成功／失敗／鎖定、資料的新增編輯刪除（含變更前後值）、設定變更、憑證增減、
通知送出與失敗。同時以結構化 JSON 印到 stdout。`ip` 依序取 `CF-Connecting-IP` →
`X-Forwarded-For` 最右段 → `unknown`。

設定頁加一個「操作紀錄」列表，可依動作類型與日期篩選。保留天數存在
`settings['audit.keepDays']`（預設 180），由每日排程一併清理。

## 頁面與 UI

單一埠、單一 Next process。所有路由都在同一個來源下，授權由 session 決定：

```
app/
  setup/page.tsx            首次訪問的初始化：設定使用者名稱與密碼，或選擇不設
  login/page.tsx            密碼登入（＋已啟用時的 passkey 快捷）
  change-password/page.tsx  臨時密碼登入後強制導向此頁
  (app)/
    layout.tsx              AppShell：session 驗證、設備切換器、底部 tab bar／側邊欄
    page.tsx                依「最後使用的設備」302 導向 /d/<id>
    d/[deviceId]/
      page.tsx              該設備首頁
      consumables/          耗材紀錄（list / new / [id]/edit）
      water/                水質紀錄（list + inline add / [id]/edit）
      report/page.tsx       報表（?with=2,3 加入其他設備比較）
    settings/               設定（devices / notifications / data / audit / login）
      devices/[id]/page.tsx 該設備的種類與耗材、專屬連結、QR Code 下載
      data/page.tsx         JSON 匯出與匯入
      login/page.tsx        快速登入：passkey 憑證自助管理（新增本裝置的 passkey、命名、
                            刪除）。僅在 admin 已啟用 passkey 時可用，否則顯示原因並連結
                            到 admin
    admin/                  管理：改密碼（無密碼模式下不需 session 即可設定）、passkey
      page.tsx              全域開關與完整憑證清單（含緊急撤銷）、對外網址、ntfy 連線與
                            兩個 topic、測試通知、重新產生 session 金鑰、手動觸發通知掃描
  api/
    auth/login|logout|options|verify   密碼登入、登出、WebAuthn 挑戰與驗簽
    export/route.ts                    JSON 匯出
    import/route.ts                    JSON 匯入，破壞性操作
```

`/setup` 只在尚未初始化時可用，完成後永久 404。其餘路由一律要求有效 session；
`/login` 與 `/setup` 是唯二例外。`BASE_PATH` 設定時全部往前綴底下移（Next.js `basePath`
自動處理）。

每個 `page.tsx` 都是 Server Component 直接查資料庫，不寫讀取用的 API 層。Client Component
只作為葉節點（tab bar、設備切換器、表單、圖表）。因為日期是字串，Server → Client 的 props
全部可直接序列化。

寫入一律用 Server Action（`next-safe-action` + zod），只有 cron、export、import 走 route
handler。**每個 action 內部都要重新驗證授權**，Server Action 是公開的 HTTP 端點，不能只靠
頁面守衛。

zod schema 用 `discriminatedUnion('type')` 區分 PURCHASE / REPLACE，PPM 欄位只存在於
REPLACE 分支。跨欄位檢查（原水純水必須成對、純水不得高於原水）放在 union 外層的
`superRefine`。

導覽：手機底部五個 tab（首頁／耗材／水質／報表／設定），桌機側邊欄。底部列需要
`env(safe-area-inset-bottom)`，root layout 設 `viewport: { viewportFit: 'cover' }`；
內容區留 `pb-20 md:pb-0`。用 `h-dvh` 不用 `h-screen`。

設備放在網址路徑裡（`/d/<deviceId>/…`），不存 cookie——每台飲水機有自己的一組專屬連結，
可各自印一張 QR 貼在該台機器上。cookie 只降級為「最後使用的設備」，唯一用途是決定 `/`
要導向哪一台。設備切換器放在 shell 頁首，`devices.length >= 2` 才渲染；切換時把網址的
`<deviceId>` 換掉並停在同一個分頁。

設備設定頁內建 QR Code 產生器：顯示預覽並可直接下載 PNG，圖片裡燒進設備名稱，檔名用設備
名稱（`廚下RO-qr.png`）。實作用用戶端 canvas：畫 QR、`fillText` 寫上設備名稱與網址、
`canvas.toBlob()` 觸發下載，不需要伺服器端影像函式庫。`qrcode` 的瀏覽器建置延遲載入。

**網址由伺服器以 `PUBLIC_URL` 組好後傳下來，不要用 `window.location.origin` 推導**——
`PUBLIC_URL` 可能含 `BASE_PATH` 前綴，且與瀏覽器當下位址未必相同。

### 更換表單（30 秒內完成的關鍵）

版面順序刻意是**日期 → PPM → 耗材項目**。`type=purchase` 時整個 PPM 區塊不渲染。

- **範本 chip**：伺服器撈最近 10 筆更換事件，依品項組合去重排序，產出「同上次 · 第一道×1
  第二三道×1」與「全換 · 6 項」。一鍵填滿整個列表。
- **兩階抽屜挑選器**：第一階列出啟用中的種類（帶顏色、庫存、逾期天數，逾期標紅）；第二階
  列出該種類的耗材。種類底下只有一個耗材時直接跳過第二階。
- 種類底下沒有耗材時，第二階要能就地新增並選用（系統預設不帶任何耗材品項）。
- 數量用 `[−] 1 [+]` 步進器（44px 觸控目標），不用數字輸入框；重複挑選同一耗材時合併數量
  並提示，而不是報錯。
- 送出後 `sonner` toast 顯示「已儲存 · 第一道下次更換日 2027-03-05」並附 5 秒內可按的「復原」。

## 報表

主圖 PPM 折線（橘＝原水、藍＝純水）＋ 下方每個種類一列的圓點泳道，兩者共用 X 軸。

用 ECharts 的雙 grid：`grid[0]` 放 PPM、`grid[1]` 放泳道，兩者 `left` / `right` 給相同的
數值。泳道的 Y 軸是 `type: 'category'` 且 `inverse: true`，散點資料為
`[timestamp, laneIndex]`，種類順序由上而下對應第一道→第六道。

三個關鍵設定：

- `axisPointer: { link: [{ xAxisIndex: 'all' }] }`——跨面板十字準線連動。
- `tooltip: { trigger: 'axis', triggerOn: 'click', confine: true }`——`trigger: 'axis'`
  而非 `'item'`，手指點在圖上任何位置都會吸附到最近的日期。
- `dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }]`——雙指縮放與單指平移，跨兩個面板。
  外層加 `touch-action: pan-y` 讓垂直捲動仍歸頁面。

下次更換日用 `markLine` 畫虛線。圖例改用 HTML 自行渲染而非 ECharts 內建，每一項兼作
篩選開關（`dispatchAction: 'legendToggleSelect'`）。

預設只畫近 12 個月，提供 3個月／1年／全部切換。只渲染 `active` 的種類為泳道。整體高度約
430px。

ECharts 必須 `next/dynamic(..., { ssr: false })`，用 `echarts/core` 的 tree-shaken import
（`import * as echarts from 'echarts'` 約 1MB，不要這樣做）。不使用 `echarts-for-react`
（React 19 下有 resize observer 的已知錯誤），自寫約 30 行的 init / resize / dispose hook。

## Docker

Dockerfile：三階段（deps / builder / runner），base image 統一用
`node:22.20.0-bookworm-slim`（better-sqlite3 是原生模組，builder 與 runner 的 glibc
必須一致，混用 Alpine 會出現 `invalid ELF header`）。

runner 階段除了官方 standalone 的三行 COPY 之外，還要手動搬：
- `drizzle/`（migration 的 `.sql` 檔是純資料，不是 import 目標）
- （不需要）`better-sqlite3` 的 `prebuilds/*.node`——output tracing 會自動帶走，不用手動 COPY

`RUN mkdir -p /data && chmod 0777 /data .next`，**不寫死 `USER`**，執行身分交由部署者用
Docker 原生的 `user:` 欄位決定——每個人的主機 uid 都不一樣（一般 Linux 常是 1000，
Synology 可能是 1026，LXC 又不同），寫死 `USER node` 會讓容器對 bind 進來的目錄沒有寫入權限。

資料庫連線開啟 `journal_mode = WAL`、`synchronous = NORMAL`、`busy_timeout = 5000`、
**`foreign_keys = ON`**（SQLite 預設是關的，不開的話所有 cascade 與 restrict 全部是裝飾品）。

volume 全部用 bind mount 指向專案資料夾內（`./data`、`./secrets:ro`）。macOS 的 Docker
Desktop 會自動遮蔽 uid 不符的問題，**這一項在 Mac 上測不出來**，必須到實體機（NAS）上實際
驗證。**絕對不要把 SQLite 檔放在 NFS／SMB 上**，檔案鎖不可靠會靜默損毀資料。

**不內建備份功能**，交給部署者用自己習慣的方式（NAS 快照、rsync、Restic）。README 提醒：
WAL 模式下不能在容器執行中直接複製 `.sqlite3`，正確做法是先停容器再複製，或用
`sqlite3 app.sqlite3 ".backup out.sqlite3"`。

### 資料匯出與匯入

- **匯出**：`/api/export` 產生單一 JSON，人類可讀，與 schema 版本解耦。
- **匯入**：上傳該 JSON 還原，破壞性操作，需二次確認，提供「合併」與「取代」兩種模式。

**範圍刻意排除認證與稽核資料**——只含 `devices`／`categories`／`items`／`events`／
`event_items`／`readings`／`notify_rules`／`settings`，不含 `credentials`、`auth_state`、
`audit_log`、`notify_log`、`machine_config`。理由：passkey 憑證綁定 RP ID 換機器就失效；
能匯入他人憑證檔等於一條後門；`audit_log`／`notify_log` 混入別台的會失去可信度或壓住新機器
的提醒。

匯入放在 App 端設定頁（需要 passkey 或密碼），不放獨立管理端——它會改寫全部資料，
權限要求應該比一般設定更高。

### 環境變數

**沒有任何必填的環境變數。** 所有站台專屬設定都能在 admin 頁面上填，存進
`machine_config` 表；環境變數只是可選的覆寫。**環境變數優先，且 UI 要誠實反映這件事**：
某一項有設環境變數時，管理中心的對應欄位變成唯讀並標示「由環境變數控制」。

| 變數 | 預設 | 說明 |
|---|---|---|
| `PUBLIC_URL` | 管理中心填 | 對外網址。啟用 passkey 時必填且需為帶網域的 https；不啟用時只有需要對外連結（QR Code）時才要填。改動會使所有既有 passkey 失效，UI 要二次確認 |
| `SESSION_SECRET` | 首次啟動自動產生 | 見下方 |
| `NTFY_URL` / `NTFY_TOPIC_FILTER` / `NTFY_TOPIC_SECURITY` | 管理中心填 | 留空＝通知停用，App 照常運作 |
| `NTFY_TOKEN` 或 `NTFY_USER`+`NTFY_PASSWORD`／`NTFY_PASSWORD_FILE` | 管理中心填 | ntfy 認證，擇一。有 token 就優先用 |
| `PORT` | `8085` | 唯一的對外埠 |
| `BASE_PATH` | 空 | 把整個 App 掛在子路徑下，需與 `PUBLIC_URL` 前綴一致 |
| `TEMP_PASSWORD` | 空 | 救援用臨時密碼，留著等同永久後門 |
| `DATABASE_PATH` | `/data/app.sqlite3` | |
| `TZ` | `Asia/Taipei` | |
| `REAL_IP_HEADER` | 空（自動） | 僅影響日誌準確度，不涉授權 |
| `LOG_LEVEL` | `info` | |

`PORT` 與 `BASE_PATH` 留在環境變數而不進資料庫，因為必須在讀資料庫之前就決定要監聽哪裡、
掛在哪個前綴。

### session 金鑰自動產生

首次啟動時若 `/data/session.key` 不存在就產生一把並以 0600 寫入（`SESSION_SECRET` 有設
就優先用它）。放在檔案而不是資料庫的理由：`settings` 會被 JSON 匯出帶走，金鑰放那裡每次
匯出都等於交出去。

管理中心提供「重新產生 session 金鑰」按鈕，旁邊直接寫明後果：

> 重新產生後，所有已登入的裝置都會被登出，需要重新以 passkey 登入。
> passkey 本身不受影響，不必重新註冊。

**術語統一**：`SESSION_SECRET`、session 金鑰指同一個東西，文件與 UI 一律用「session 金鑰」。

`TZ` 在 Dockerfile 內預設 `Asia/Taipei`。**唯一刻意不跟 `TZ` 的是結構化日誌的時間戳**，
保持 UTC ISO8601 以便跨機器排序比對；使用者看得到的東西一律跟著 `TZ`。

`PUID`／`PGID` 由 Docker 原生的 `user:` 取代；`NOTIFY_HOUR`、`NOTIFY_CATCHUP_MAX_DAYS`
是使用者偏好，移入設定頁；`CRON_SECRET` 移除——手動觸發掃描是 `/admin` 底下的一般功能，
跟其他頁面共用同一條 session 驗證，**不是掛在另一個埠上**，不需要另一組密鑰。

## 建置順序

每個階段結束時都應該是可以跑起來、看得到東西的狀態。

| # | 內容 | 為什麼在這個位置 |
|---|---|---|
| 0 | 骨架：Next 16 + Tailwind v4 + shadcn、Drizzle + better-sqlite3、`lib/date.ts`、`(app)` shell 與五分頁導覽、種子資料、Dockerfile + compose | 確認容器起得來、SQLite 與 WAL 檔出現在資料目錄裡 |
| 1 | 登入：初始化流程 → 密碼雜湊 → session → 限流 → 臨時密碼救援 ＋ audit_log 骨架 | tunnel 已經開著，必須早做。限流與臨時密碼的單元測試在這一步寫（注入假時鐘）。移除舊 TOTP 程式碼與 `cf-access.ts` |
| 2 | 設定 → 設備 / 種類 / 耗材 CRUD | 系統不預載耗材，其他頁面全部依賴這裡 |
| 3 | 水質紀錄 CRUD | 最簡單的表單，但完整走過 Server Action + zod + `revalidatePath` + 字串日期的整條路徑 |
| 4 | 耗材紀錄：事件表單、reading 連動 transaction、成本欄位、`lib/due.ts` | 最大的一塊。先做更換再做新購 |
| 5 | 首頁狀態卡 | `lib/due.ts` 已存在，很便宜 |
| 6 | JSON 匯出／匯入 + 設備 QR Code 產生器 + PWA manifest | 匯出匯入要成對做；PWA 讓「加到主畫面」成立 |
| 7 | 通知：規則 CRUD、發送時刻與補送天數設定、`lib/ntfy.ts`、sweep、croner、admin 介面的手動觸發 | 需要階段 4 的到期日 |
| 8 | 報表：ECharts 雙 grid + 泳道 + 下次更換日 + 時間範圍 | 最需要打磨，也最需要真實資料來調 |
| 9 | **passkey**：`credentials` 表、`machine_config` 表、WebAuthn 挑戰/驗簽 route、admin 的全域開關與完整憑證清單（含緊急撤銷）、`(app)/settings/login` 的自助註冊頁 | 需要階段 1 的密碼登入作為授權地板，且要有可用的 admin／app settings 頁面才能放這些入口 |
| 10 | 設備切換器 + 跨設備比較（`?with=`）＋ 操作紀錄頁 | 路由從階段 2 起就是 `/d/[deviceId]/…`，這裡純粹補 UI |

**刻意延後**：`ADJUST` 的操作介面（枚舉值階段 0 就加，畫面等第一次看到負庫存再做）。
**刻意不做**：耗材層級的週期覆寫、第二三道的覆蓋關係圖遍歷。

## 驗證方式

1. **容器**：`docker compose up -d --build` 後 `docker compose exec app ls -la /data`
   應看到 `app.sqlite3` 與 `-wal`、`-shm`；確認 `PRAGMA foreign_keys` 回傳 1。
2. **初始化與登入**：首次開啟應導向 `/setup`；設定密碼後 `/setup` 應永久 404。未登入存取
   任何頁面應導向 `/login`。連續輸錯密碼應觸發限流。帶偽造 session cookie 的請求應被拒絕。
3. **passkey 註冊**：用密碼登入 → 先到 admin 開啟 passkey 全域開關（需先確認 `PUBLIC_URL`
   是帶網域的 https）→ 到 `(app)/settings/login`（app 一般設定頁，不是 admin）自助
   註冊一把 passkey → 登出 → 用 passkey 重新登入成功 → 手機收到「新 passkey 註冊成功」
   的 ntfy 推播。**再驗證 admin 端的緊急撤銷**：在 admin 的完整憑證清單刪除該筆 →
   該裝置應無法再用 passkey 登入。若 admin 尚未開啟 passkey 開關，`(app)/settings/login`
   應顯示原因並連結到 admin，而不是空白或報錯。**不應該有任何 QR 或 token 涉入這個
   流程**——若實作出現這類東西，代表退回了舊設計，要停下來重看本節。
4. **真實 IP**：從非本機網路連入，確認 audit_log 與 proxy 的 access log 記到的是真實對外
   IP 而非容器內部位址。
5. **ntfy**：設定頁按「傳送測試通知」，收到中文標題；故意填錯 URL 與密碼，確認錯誤訊息
   分類正確。
6. **通知冪等**：手動觸發掃描三次，第二三次送出數應為 0；把系統日期往前調再跑，驗證補送
   與彙總。
7. **事件連動**：建一筆含 PPM 的更換事件 → 水質頁應出現對應紀錄 → 改事件日期 →
   **確認圖上的點跟著移動**（最容易漏的 bug）→ 刪事件 → 該筆水質紀錄應一併消失。
8. **圖表**：375×812 檢視報表頁，確認泳道與主圖 X 軸對齊、點擊任意位置都能叫出 tooltip、
   雙指縮放有效、垂直捲動仍歸頁面。
9. **單一埠**：確認整個系統只對外發布一個埠，`docker compose ps` 或 `docker inspect`
   不應出現第二個對外埠。

## 實作時需要當場確認的事項

- Next.js 與各套件的實際最新版本（EOL 日期與版本號以安裝當下為準）。Next 16 的
  `middleware.ts` 已更名為 `proxy.ts`、函式名改為 `proxy`。
- `drizzle-orm` 與 `drizzle-kit` 的版本相容性，安裝後先跑一次 `drizzle-kit generate` 確認。
- ECharts 6 的 `axisPointer.link` 精確形狀——若跨面板十字準線沒作用，第一個要查的就是
  這一行。
- Server Action 的 origin 檢查（`experimental.serverActions.allowedOrigins`）由
  `PUBLIC_URL` 推導，不另設環境變數；並確認代理／tunnel 沒有改寫 Host。

---

# 階段 A：部署到 NAS 與開源發佈

## Context

程式已完成階段 0，階段 1 依上方決策改寫為密碼＋passkey。現在要 (1) 部署到家中的 Synology
NAS，(2) 以開源形式發佈到 GitHub。

實地勘查 NAS（`ssh monas`）確認的環境：

| 項目 | 現況 | 對設計的影響 |
|---|---|---|
| 主機 | Synology x86_64、DSM 核心 4.4.302+ | Mac 是 arm64，不能在本機建置後直接搬過去 |
| Docker | 24.0.2、compose 2.20.1 | |
| buildx | 未安裝（cli-plugins 只有 docker-compose） | `# syntax=` 與 `--mount=type=cache` 在那裡會失敗，Dockerfile 不能用這兩者 |
| 共用網路 | `cloudflare_tunnel_default`（external），`service_proxy` 與 `ntfy` 都在上面 | app 加入該網路，cloudflared 以容器名稱路由到**單一埠** |
| ntfy | 已在同一台，內部 `http://ntfy:80`，對外 `https://ntfy.freediving.site` | 走內部網路，不必繞出去 |
| ntfy 認證 | `NTFY_AUTH_DEFAULT_ACCESS=deny-all` + 啟用登入 | 必須建立有寫入權限的 token |
| 使用者 | `amo` = uid 1026 / gid 100 | 映像內是 `node`(uid 1000)，bind mount 會寫不進去，故 Dockerfile 不寫死 USER |
| 慣例 | 目錄小寫底線、檔名 `compose.yaml`、外部服務加入共用網路 | 照著跟 |
| git | NAS 上未安裝 | 不在 NAS 上 clone，只放 compose |

**安全提醒**：`/volume1/docker/cloudflare_tunnel/compose.yaml` 把 tunnel token 寫在
`command:` 參數裡，勘查時被印進對話紀錄，建議到 Cloudflare Zero Trust 重新產生該 tunnel
的 token。與本專案無關，但同一原則適用於接下來的公開 repo：**任何 token 都不進 repo**。

## 決策

| 項目 | 決定 |
|---|---|
| 映像來源 | GHCR 為主（`ghcr.io/rebirth00723/water-filter-tracker`），保留註解掉的 `build:` |
| 對外路徑 | 不放反向代理。TLS 由既有的 cloudflared 終結；**只有一個埠**（`8085`），走容器網路，cloudflared 以容器名稱路由 |
| Repo | `rebirth00723/water-filter-tracker`，公開，MIT |
| QR Code | App 內建產生器（設備設定頁下載 PNG，圖片含設備名稱）。每台設備一張，與登入無關 |
| NAS 目錄 | `/volume1/docker/water_filter_tracker/`，該目錄專屬此 compose |
| Cloudflare Access | 不使用——與本專案的密碼＋passkey 存取控制重複，且會讓開源專案綁定單一廠商 |

## 一、程式碼調整

### Dockerfile

- 移除 `# syntax=docker/dockerfile:1.7` 與 `RUN --mount=type=cache`——NAS 沒有 buildx，
  舊版 builder 不支援這兩者，改用單純的 `RUN npm ci`。GHCR 的 CI 建置有 GitHub Actions
  快取，不損失多少。
- 不寫死 `USER node`：建立 `/data` 與 `.next` 時 `chmod 0777`，執行身分交由 compose 的
  `user:` 決定。
- 不需要手動 COPY `bindings` / `file-uri-to-path`（better-sqlite3 v13 已改用
  `prebuilds/`，tracing 會自動帶走）。

### compose.yaml（取代原本的 `docker-compose.yml`）

- 只有**一個** service（`app`），只監聽**一個**埠 `8085`。不要出現第二個埠或「管理埠」
  的設計，那是需要修正的舊稿殘留。
- `image: ghcr.io/rebirth00723/water-filter-tracker:latest`（可用 `${IMAGE_TAG:-latest}`
  讓 `.env` 的 `IMAGE_TAG` 可選），下方保留註解掉的 `build: .`。
- `container_name: water-filter-tracker`——cloudflared 用這個名字路由。
- `networks: [cloudflare_tunnel_default]`，宣告為 `external: true`。
- **不需要 `ports:`**——cloudflared 經容器網路以 `http://water-filter-tracker:8085`
  直接路由。想從區網直接連的話再自行發布該埠。
- `user:` 使用 Docker 原生欄位，本機部署時填入 `id -u`／`id -g` 的值；repo 的範例把它
  註解掉並說明何時需要。
- volumes 全部用 bind mount 指向專案資料夾內：`./data`、`./secrets:ro`。
- 環境變數全部可選（見主計畫的環境變數表）。作者環境會填 `PUBLIC_URL` 與
  `NTFY_URL: http://ntfy:80`（走內部網路），其餘留給管理中心設定。
- session 金鑰首次啟動自動產生於 `/data/session.key`，因此 `secrets/` 目錄變成可選——
  只有想用宣告式設定管理 ntfy 密碼的人才需要它（`NTFY_PASSWORD_FILE`）。

### 其他

- `next.config.ts`：Server Action 的 `allowedOrigins` 由 `PUBLIC_URL` 推導。
- 新增 `LICENSE`（MIT）。
- `.gitignore` 已涵蓋 `secrets/`、`.env`、`data/`，公開前再確認一次。

## 二、GitHub 發佈

### 前置

1. `~/.ssh/known_hosts` 缺 github.com，且沒有 `Host github.com` 條目指向可用金鑰。
   `~/.ssh/this_mac` 可認證為 `rebirth00723`。採用 repo 本地設定（不動全域 ssh config）：
   ```
   git config core.sshCommand "ssh -i ~/.ssh/this_mac -o IdentitiesOnly=yes"
   ```
   並用 `ssh-keyscan github.com >> ~/.ssh/known_hosts` 補上主機金鑰（比對 GitHub 官方
   公佈的指紋）。
2. `~/.ssh/known_hosts` 缺 `[monas]:2424`。`~/.ssh/config` 指向 Tailscale 名稱 `monas`
   （解析到 100.107.53.125），已驗證與舊的 `[192.168.0.30]:2424` 主機金鑰指紋完全相同
   （`SHA256:cd0f4iCO5lBadvOvzIbADtgaJgXHpatI0ujy4KM67M4`），確定是同一台機器，補上該
   條目是安全的。

### Repo 內容

- `README.md`（英文，GitHub 預設著陸頁）與 `README.zh-TW.md`（繁中完整版），兩份都寫完整。
- README 要涵蓋**兩種部署形態**：
  - (a) 只在區網用：不必有網域或憑證，只開本地埠，完整功能。
  - (b) 要遠端存取：需要 HTTPS 網域（tunnel、反向代理，或 `tailscale cert`），設
    `PUBLIC_URL` 並註冊 passkey。本地埠照樣可用，同時是斷網備援。
  講清楚 (b) 的 HTTPS **不是本專案的要求，是瀏覽器的要求**——WebAuthn 在非安全內容下
  根本不存在。並附取得憑證的幾條路（`tailscale cert`、內部網域走 DNS-01、mkcert 內部 CA）。
- 首次啟動就是開網站設定密碼，沒有 token、沒有 CLI 步驟。README 提醒：**請在對外開放
  之前完成初始化**。
- README 架構採開源慣例：功能簡介與截圖位、Quick start（`docker compose up -d`
  三行內跑起來）、完整環境變數表、反向代理設定、資料位置與自行備份的提醒、安全性說明、
  Contributing、License。
- QR Code 章節：App 內建產生器（設定 → 設備 → 下載 QR），圖片含設備名稱，每台設備各印
  一張貼在該台機器上——這與登入無關，純粹是「掃了直接進到那一台的記錄頁」的功能。
- 安全性章節要明確寫出：請在對外開放之前完成初始化、`TEMP_PASSWORD` 留在 env 等同永久
  後門、純 HTTP 環境無法使用 passkey、passkey 綁定網域因此換網域要全部重新註冊、忘記密碼
  時用 `TEMP_PASSWORD` 救援。

### CI（`.github/workflows/docker.yml`）

- 觸發：push 到 `main`、tag `v*`、手動。
- `docker/build-push-action` 建置 `linux/amd64`（NAS 是 x86_64；`linux/arm64` 可一併出）。
- 認證用內建 `GITHUB_TOKEN` + `permissions: packages: write`。
- 標籤：`latest`、`sha-<short>`、以及 tag 對應的語意化版本。
- 另加一個定期清理 untagged 映像的 workflow。
- 第一次推送後套件預設是私有，需到 repo 的 Packages 頁面手動改為 public（一次性）。

## 三、NAS 部署

在 `/volume1/docker/water_filter_tracker/` 建立：

```
compose.yaml          從 repo 複製
.env                  IMAGE_TAG；其餘設定可留給管理中心填
data/                 SQLite 與 session.key（首次啟動自動建立）
secrets/              可選——只有想用檔案管理 ntfy 密碼時才需要
```

### 需要開發者自己操作的三件事

1. **Cloudflare Zero Trust**：新增 public hostname（建議 `water.freediving.site`）指向
   `http://water-filter-tracker:8085`。tunnel 是 token 模式，ingress 只能在 dashboard
   設定。**不要設 `httpHostHeader`**。
2. **ntfy token 與 ACL**：ntfy 是 `deny-all`，需要一個對兩個 topic 都有 write 權限的
   token，用 `docker exec ntfy ntfy ...` 產生並授權——這會更動現有 ntfy，執行前先確認。
   兩個 topic 取共用前綴（如 `water-filter` 與 `water-filter-security`），ACL 用萬用字元
   一次涵蓋。
3. **完成初始化與設定**：容器起來後開 `https://water.freediving.site`：
   - 進入 `/setup` 設定使用者名稱與密碼（**在對外開放之前做完**）
   - 到 admin 頁填 ntfy 連線與兩個 topic，按「傳送測試通知」確認通得了
   - 若要用 passkey：確認 `PUBLIC_URL` 是帶網域的 https，在 admin 開啟後於手機註冊

   建議在 compose 先設一組 `TEMP_PASSWORD` 作為忘記密碼時的救援，**確認一切正常後把它
   移除並重啟**。

## 驗證

1. **CI**：push 後 Actions 綠燈，`ghcr.io/rebirth00723/water-filter-tracker:latest`
   出現且可公開拉取。
2. **啟動**：`docker compose up -d` 後 `docker compose logs app` 出現「啟動完成」的
   JSON 行，`data/` 下出現 `app.sqlite3`、`-wal`、`-shm` 與 `session.key`（0600）。
3. **權限**：`docker compose exec app touch /data/.wtest && rm /data/.wtest` 成功——
   這是主機 uid 與容器執行身分對不對得上的關鍵，**在 macOS 上測不出來**。
4. **授權**：未登入時任何頁面都導向 `/login`；初始化完成後 `/setup` 回 404；臨時密碼
   登入後被強制導向改密碼頁且無法繞過，改完後該提醒仍持續顯示（因為 env 還留著）。
5. **內部連通**：`docker compose exec app node -e "fetch('http://ntfy:80/v1/health')..."`。
6. **通知**：管理中心按「傳送測試通知」，確認濾心與安全兩個 topic 各自收得到。
7. **對外登入**：從非家中網路開 `https://water.freediving.site` → 要求 passkey →
   登入成功（一般登入不推播）→ `audit_log` 記到的是真實對外 IP。
8. **斷網備援**：把埠發布到區網（`ports: ["8085:8085"]`），暫停 cloudflared，確認
   tunnel 網址不通，而 `http://<NAS>:8085` 仍能用**密碼**登入並正常記錄。
9. **開源可用性**：乾淨目錄只放 `compose.yaml`（不放 `.env`、不放 `secrets/`），
   `docker compose up -d` 應能起來，並可在管理中心完成全部設定。
