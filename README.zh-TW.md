# 淨水器耗材與水質記錄系統

自架、手機優先的 RO 淨水器耗材與水質記錄工具。

記錄耗材新購與更換（含成本）、記錄原水與純水的 TDS（ppm），把兩者疊在同一條時間軸上
讓濾心衰退看得出來，並在接近更換日時透過 [ntfy](https://ntfy.sh) 主動推播。

[English](./README.md)

---

## 為什麼做這個

濾心的更換日期靠記憶，所以一定會忘。而原水本身會隨季節與水源變動，
**單看純水的絕對值會誤判** —— 夏天 12 ppm、冬天 18 ppm 可能是同一支健康的濾心。
真正要看的是去除率隨時間的變化，而且要把更換事件標在同一條軸上。

這個 App 就只做這件事：兩個數字、一份換了什麼的清單，以及一張把它們放在一起的圖。

## 功能

**耗材紀錄** —— 站在水槽邊 30 秒內記完一次更換。範本 chip 一鍵套用上次的組合；
兩階挑選器把每一道的庫存與逾期天數直接標在上面，所以挑選器本身就是待辦清單。
新購另記單價與購買來源。

**水質紀錄** —— 原水與純水 ppm，即時顯示去除率。更換當天填的 PPM 由那筆更換事件擁有：
改事件日期，圖上的點會跟著移動。

**報表** —— PPM 折線圖，下方是各種類的更換泳道，兩者共用同一條時間軸。
點圖上任何位置都會吸附到最近的日期，同時列出當天的 PPM 與所有更換項目。
手機上兩指縮放，五年的資料也看得動。

**提醒** —— 提前提醒（14 天、3 天、當天）與逾期重複提醒，每一條各自可設發送時刻、
訊息樣板與優先度。濾心提醒與安全事件走兩個不同的 ntfy topic，
後者才不會被前者淹沒。

**多台設備** —— 每台淨水器有自己的網址（`/d/1`、`/d/2`）與可下載的專屬 QR Code，
圖片裡燒進設備名稱。一台貼一張。

**登入** —— 密碼永遠要求；有 HTTPS 時可加上 [passkey](#passkey) 作為快捷。
資料是單一 SQLite 檔，可匯出成 JSON 搬到別台機器。

## 快速開始

```bash
mkdir water-filter-tracker && cd water-filter-tracker
curl -O https://raw.githubusercontent.com/rebirth00723/water-filter-tracker/main/compose.yaml
docker compose up -d
```

然後開 `http://<主機>:8085`，設定使用者名稱與密碼。設定就這樣結束了 ——
沒有 token、沒有 CLI 步驟、也不必先改任何設定檔。

> [!IMPORTANT]
> **請在把服務對外開放之前完成首次設定。** 初始化頁面刻意沒有保護 ——
> 誰先開到誰就佔到那個帳號。只在區網用的話這不影響；
> 若要走 tunnel，請先設好密碼再把公開網址指過來。

其餘設定（對外網址、ntfy 連線、通知規則）全部在網頁上填。**沒有任何必填的環境變數。**

## 兩種部署形態

### (a) 只在區網用

不需要網域、不需要憑證、不需要反向代理。把埠發布出來就結束了：

```yaml
services:
  app:
    image: ghcr.io/rebirth00723/water-filter-tracker:latest
    ports: ['8085:8085']
    volumes: ['./data:/data']
```

功能完整 —— 記錄、報表、提醒、QR Code（在管理中心把對外網址填成
`http://192.168.x.x:8085` 即可）。唯一不能用的是 passkey，
因為瀏覽器在純 HTTP 下不提供 WebAuthn。密碼登入照常。

### (b) 要遠端存取

需要帶網域名稱的 HTTPS。把 tunnel 或反向代理指向這個容器，
並在管理中心（或用 `PUBLIC_URL`）填入對外網址。

**HTTPS 這個要求是瀏覽器的，不是本專案的。** WebAuthn 在非安全內容下根本不存在，
而 WebAuthn 的 RP ID 依規範必須是網域名稱 —— IP 位址不合法。
想用 passkey 就一定要有憑證。不必花錢的幾條路：

| 情況 | 做法 |
|---|---|
| 你有用 Tailscale | `tailscale cert <host>.<tailnet>.ts.net` —— 免費、自動續約 |
| 你有公開網域 | Cloudflare Tunnel，或 Caddy／Traefik 配 Let's Encrypt |
| 只有內部網域 | Let's Encrypt 走 DNS-01（不需要開對外埠） |
| 完全沒有網域 | [mkcert](https://github.com/FiloSottile/mkcert) 內部 CA —— 但每台裝置都要裝根憑證 |

**區網的埠請照樣發布出來。** 密碼登入在純 HTTP 下可用，所以 tunnel 掛掉時
你仍然進得去、記得了。這正是「把密碼當地板而不是只做 passkey」的實際回報。

用反向代理的話，**不要改寫 `Host` header** —— Next.js 靠比對 `Origin` 與 `Host`
來擋跨站寫入，改寫 Host 會讓那個檢查失敗。（Cloudflare Tunnel 裡是
`httpHostHeader` 這個選項，留空即可。）

## QR Code

設定 → 設備 → 選一台 → **下載 PNG**。

圖片裡含 QR、設備名稱與網址。印一張貼在機器上，掃了就直接開那一台的記錄頁 ——
不必記網址、不必切換設備、也不必裝 App。有三台淨水器的時候，
這是「這個工具會被用」與「不會被用」的差別。

網址是伺服器用你設定的對外網址組好的，**不是從 `window.location` 推導**。
這是刻意的：如果你從區網 IP 開設定頁，從瀏覽器推導出來的 QR 掃了會進不去。

## 通知

在管理中心指向任何 ntfy 伺服器（自架或 ntfy.sh）。留空就是關閉通知，其餘功能照常。

兩個 topic、共用一組認證：

- **濾心提醒** —— 「第一道再 14 天就該換了」
- **安全事件** —— 有 passkey 被註冊或撤銷

分開的理由是：每隔幾週一次的濾心提醒會把那則你需要立刻看到的訊息淹掉。

### topic 名稱算不算密碼？

**取決於你的 ntfy 伺服器設定，而且兩種情況的建議剛好相反：**

| 伺服器設定 | topic ＝密碼？ | 該怎麼做 |
|---|---|---|
| `ntfy.sh`，或自架但 `auth-default-access: read-write` | **是。** 知道 topic 就能訂閱與發布 | 加一段長的隨機後綴：`water-filter-a8f3d91c` |
| 自架且 `auth-default-access: deny-all` | **不是。** 沒有被授權的 token 或帳號，知道名稱也沒用 | 取人看得懂的名字 |

**建議用 access token 而不是帳號密碼**：token 外洩時可以單獨撤銷那一把，
而帳密外洩要改整個 ntfy 帳號的密碼，會影響其他用途。

認證存在資料庫裡**是明文**。能拿來加密它的金鑰就在資料庫同一個目錄下，
拿得到其中一個的人通常兩個都拿得到 —— 加密只是心理安慰。
它們也因為同樣的理由被排除在 JSON 匯出之外。

## 設定項目

每一項都有對應的網頁欄位。環境變數是給偏好宣告式設定的人用的，而且**優先於網頁設定** ——
有設環境變數的欄位在管理中心會顯示為唯讀並標示「由環境變數控制」，
而不是讓你填了卻不生效。

| 變數 | 預設 | 說明 |
|---|---|---|
| `PUBLIC_URL` | 網頁填 | 對外網址。**啟用 passkey 時必填，且必須是帶網域名稱的 https。** QR Code 與通知的點擊連結也用它。改動會讓所有既有 passkey 失效 |
| `PORT` | `8085` | 唯一的對外埠 |
| `BASE_PATH` | 空 | 把整個 App 掛在子路徑下（如 `/water`），用於同網域上路徑撞名。設了它 `PUBLIC_URL` 也要含相同前綴 |
| `TEMP_PASSWORD` | 空 | 救援用臨時密碼。**留著等同永久後門** —— 見[安全性](#安全性) |
| `DATABASE_PATH` | `/data/app.sqlite3` | |
| `SESSION_SECRET` | 自動 | 首次啟動自動產生於 `/data/session.key`（權限 0600）。想自己管理才填 |
| `SESSION_MAX_AGE_DAYS` | `30` | |
| `COOKIE_SECURE` | `auto` | `auto` 依 `X-Forwarded-Proto` 判斷。帶 `Secure` 的 cookie 在純 HTTP 下會被瀏覽器靜默丟棄，症狀是「登入成功但立刻被踢回登入頁」 |
| `NTFY_URL` | 網頁填 | 只填 base URL，**結尾不要帶 topic** —— 本 App 用 ntfy 的 JSON 端點（POST 到根路徑） |
| `NTFY_TOPIC_FILTER` / `NTFY_TOPIC_SECURITY` | 網頁填 | |
| `NTFY_TOKEN` | 網頁填 | 或 `NTFY_USER` + `NTFY_PASSWORD`。兩者都設時 token 優先 |
| `TZ` | 系統時區，映像內預設 `Asia/Taipei` | IANA 名稱。影響「今天是哪一天」、到期日推算與通知發送時刻。打錯字會退回系統時區並在日誌留一行，不會讓服務起不來 |
| `SESSION_KEY_PATH` | 資料庫旁 | 自動產生的 session 金鑰檔要放哪 |
| `REAL_IP_HEADER` | 自動 | 指定單一 header 取得訪客 IP。**只影響日誌準確度** —— 授權完全不看 IP 或 header |
| `LOG_LEVEL` | `info` | |

任何變數都可以加 `_FILE` 後綴指向檔案（給 Docker secret 用）：
`NTFY_PASSWORD_FILE=/run/secrets/ntfy`。

要以非 root 執行？映像**刻意不寫死 `USER`**，因為每台主機的 uid 都不一樣
（一般 Linux 常是 1000、某些 NAS 是 1026、LXC 裡又不同）。
用 Docker 自己的欄位：

```yaml
user: "1000:1000"   # 你的 `id -u`:`id -g`
```

## 資料與備份

全部就是一個檔：`./data/app.sqlite3`。

**刻意不內建備份功能** —— NAS 快照、rsync、Restic 都比 App 自己做的可靠，
而你大概已經在用其中一個了。

> [!WARNING]
> **容器執行中不要直接複製 `app.sqlite3`。** WAL 模式下最近的交易還在 `-wal` 裡，
> 複製出來的檔案可能缺資料。請先停容器再複製，或用
> `sqlite3 app.sqlite3 ".backup out.sqlite3"`。

另外：**絕對不要把資料庫放在 NFS／SMB 上。** SQLite 的檔案鎖在其上不可靠，
會靜默損毀資料。

要搬到另一台機器的話，設定 → 匯出與匯入會產生一個人類可讀的 JSON。
它刻意不含登入憑證、passkey、操作紀錄與 ntfy 連線：passkey 綁定網域，
搬過去也失效；能匯入他人憑證檔的功能等於一條後門；
而別台機器的操作紀錄不能證明任何事。

## 安全性

這個專案做了什麼：

- 密碼以 scrypt 雜湊，每組密碼獨立 salt，比對用常數時間
- 限流綁帳號（30 秒 2 次、累計 4 次鎖 10 分鐘）
- **所有登入失敗回傳完全相同的回應** —— 狀態碼、訊息、網址、耗時都一樣，
  所以無法用回應去探測某個帳號是否存在
- session 以每份部署各自產生的金鑰簽署
- CSP 帶 per-request nonce、`frame-ancestors 'none'`、`Referrer-Policy`、
  `X-Content-Type-Options`
- 每個寫入都比對 `Origin` 與 `Host`（Next.js 的 Server Action 原生就做）
- 每一次登入與資料異動都寫操作紀錄，**含變更前後值**

刻意不做的，以及原因：

- **不做 HSTS。** 長 `max-age` 一旦送出就不可逆，會把在區網用純 HTTP 自架的人鎖死。
- **首次設定頁沒有保護。** 服務要不要對外是部署者的決定；
  設定完成前的意外暴露明確不在本設計的防護範圍內。請先設定完再對外。
- **不用廠商專屬的驗證**（例如 Cloudflare Access）。把開源專案綁在單一廠商上
  就失去意義了。

值得知道的：

- **`TEMP_PASSWORD` 留在設定裡就是永久後門。** 它存在的理由是避免改了密碼又忘記
  而完全進不去。用它登入會立刻強制修改密碼，而且只要它還在，
  登入頁**每一次**都會提醒你。用完請移除並重新啟動。
- **passkey 綁定網域。** 改了 `PUBLIC_URL` 之後所有已註冊的 passkey 都會失效，
  在同一個頁面重新註冊即可。
- **passkey 在純 HTTP 下不能用。** 那是瀏覽器的限制，不是這個 App 的。
  密碼登入永遠可用，這正是把它當地板而不是附加品的原因。
- 在管理中心重新產生 session 金鑰會登出所有裝置。**passkey 不受影響**，不必重新註冊。

### passkey

密碼是地板、passkey 是升級，**絕不會只有 passkey**。
passkey 綁定裝置與網域，所以手機遺失、換網域、或退回純 HTTP 時，
密碼是唯一還進得去的路。

註冊流程**沒有 QR Code、沒有一次性代碼**：用密碼登入，開設定 → 快速登入，
按一下，Face ID。「已經用密碼登入」本身就是授權。
伺服器只存公鑰，所以資料庫外洩也無法用來登入。

在管理中心啟用（需要帶網域的 HTTPS，且已設定密碼），
再到設定 → 快速登入逐台註冊。管理中心另有完整的憑證清單與緊急撤銷，
留給手機遺失那類情況。

## 開發

```bash
npm install
npm run dev              # http://localhost:3000
```

Migration 與種子資料會在伺服器啟動時自動執行
（`src/instrumentation.ts` → `src/lib/boot.ts`）。改了 `src/lib/db/schema.ts` 之後：

```bash
npm run db:generate      # 產生新的 migration 到 drizzle/
```

```bash
npm test                 # vitest
npm run typecheck        # 這兩件事刻意分開 —— vitest 走 esbuild，
npm run build            # **不做型別檢查**，所以「測試全過」不等於「型別正確」
```

### 目錄結構

```
src/
  app/
    (app)/               需要授權的外殼
      d/[deviceId]/      每台設備：首頁、耗材、水質、報表
      settings/          設備、通知、匯出匯入、快速登入、操作紀錄
      admin/             對外網址、ntfy、session 金鑰、passkey 開關
    api/                 auth、passkey、export、import、health
    setup|login|change-password/
  lib/
    db/                  Drizzle schema、migration、種子
    auth/                密碼、session、限流、passkey
    notify/              ntfy 客戶端、掃描、croner 排程
    schemas/             zod —— 客戶端表單與 Server Action 共用同一份
  components/
```

### 動手改之前值得知道的慣例

- **使用者可見的日期一律是 `TEXT` 的 `YYYY-MM-DD`，不用 DateTime。**
  那些是「日曆上的日期」而非時間點。字典序等於時序（所以 `MAX()`、`ORDER BY`、
  `BETWEEN` 直接可用）、跨 server/client 邊界不需序列化，
  也沒有時區差一天的問題在等著。
- **每個頁面都是 Server Component 直接查 SQLite。** 沒有讀取用的 API 層 ——
  那是這個技術棧最大的簡化。Client Component 只作為葉節點。
- **寫入一律走 Server Action，而且每一個都自己重新驗授權** ——
  Server Action 是公開的 HTTP 端點，渲染表單的那個頁面不是邊界。
- **一種形狀一份 zod schema，客戶端與伺服端共用。** 兩邊的驗證規則不可能漂移。
- **`foreign_keys = ON`** 是每條連線都要下的。SQLite 預設是關的，
  不開的話 schema 裡所有的 cascade 與 restrict 都只是裝飾。
- 碰資料庫的模組都 `import 'server-only'`。Client Component 需要的東西
  住在獨立的純模組裡（`device-path.ts`、`ppm.ts`、`audit-groups.ts`）。

## 參與貢獻

歡迎 issue 與 pull request。回報 bug 時，附上會出錯的輸入與你預期的結果最有幫助。

若是改動行為，請附上測試。`npm test` 與 `npm run typecheck` 都要過 ——
它們檢查的是不同的東西。

## 授權

[MIT](./LICENSE)
