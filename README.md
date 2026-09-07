# 淨水器耗材與水質記錄系統

自架、手機優先的單人記錄系統：記錄耗材新購／更換與成本、記錄原水與純水 PPM、
把兩者疊在同一條時間軸上判斷濾心衰退，並在接近更換日時透過 **ntfy** 主動推播。

- 前端與後端：Next.js 16（App Router）+ TypeScript
- 資料：SQLite（Drizzle ORM + better-sqlite3），WAL 模式
- 圖表：ECharts 6
- 部署：Docker Compose，`cloudflared → Caddy → app`
- 時區：Asia/Taipei（日期一律存 `YYYY-MM-DD` 字串）

## 開發

```bash
npm install
cp .env.example .env      # 至少填 SESSION_SECRET 與 APP_USERS
npm run dev
```

資料庫的 migration 與種子資料會在伺服器啟動時自動執行（`src/instrumentation.ts`），
不需要手動跑任何指令。改了 `src/lib/db/schema.ts` 之後：

```bash
npm run db:generate       # 產生新的 migration SQL 到 drizzle/
```

```bash
npm test                  # 單元測試
npm run typecheck
```

## 部署

```bash
mkdir -p backup secrets && chmod 700 secrets
# 依 secrets/README.md 建立各項機密
docker compose up -d --build
```

`app` 容器**刻意不對外發布任何連接埠**，唯一入口是 Caddy，而 Caddy 只綁在
`127.0.0.1:8080`。主機上的 cloudflared 連得到、區網上的任何人都連不到 ——
這是 `CF-Connecting-IP` 可信的前提：只要還有別的路徑能連到 app，
那條路徑上的人就能偽造這個 header。

cloudflared 的 ingress 指向 `http://localhost:8080` 即可。
**不要設 `httpHostHeader`**，那會讓 Next.js 的 Server Action origin 檢查失敗。

### Cloudflare 那邊要做什麼

`CF-Connecting-IP` 是 Cloudflare 邊緣自動附加的，**不需要任何設定**。只有兩件事要確認：

- **不要開啟 Pseudo IPv4** —— 會把該 header 換成合成的假 IPv4。
- 若設過 Transform Rules，確認沒有移除 `CF-Connecting-IP`。

**強烈建議加開 Cloudflare Access（Zero Trust，個人用免費）**：開了之後陌生人
連登入頁都看不到，本系統的 TOTP 就降級成第二道防線 —— 那才是它該待的位置。
在 `docker-compose.yml` 填入 `CF_ACCESS_TEAM_DOMAIN` 與 `CF_ACCESS_AUD` 之後，
app 會用 Cloudflare 的公鑰驗證 `Cf-Access-Jwt-Assertion`，
因此即使 tunnel 設定外流、有人直接打到 origin 也過不了。

## 登入

帳號 + 6 碼 TOTP，同一個畫面一起送出（兩段式流程會洩漏哪些帳號存在）。

```bash
npm run auth:new-user -- rose     # 產生 secret 並在終端機印出可掃描的 QR Code
```

> **設定當下請務必做兩件事**：把 secret 存進密碼管理器，並用**兩個裝置**掃同一個
> QR Code（手機 + 1Password/Bitwarden）。只有一個地方有 secret 的話，
> 手機掉了就只能 SSH 回家改設定。

### 防爆破規則

- 30 秒內最多 2 次；累計 4 次失敗鎖該帳號 10 分鐘；成功登入即歸零。
- **只鎖帳號，不看 IP。** 防枚舉靠的是「所有失敗回應完全一致 + 固定回應時間下限」，
  而不是 IP 限流；不存在的帳號完全不建立計數器，因此也灌不爆記憶體。
- 不論帳號不存在、驗證碼錯誤或處於鎖定中，一律回同一句錯誤訊息、同樣的回應時間。
  真正的原因寫在容器 log 與「設定 → 操作紀錄」裡。
- 鎖定觸發、以及**新裝置登入成功**時，都會推播 ntfy。
  （失敗通知是雜訊，自己打錯也會觸發；成功通知才是訊號。）

### 被鎖住了怎麼辦

計數器只存在記憶體，**重啟容器即全部解鎖**：

```bash
docker compose restart app
```

這是刻意保留的自救後門。人不在家時改用 `RECOVERY_CODE`：
附上它可略過鎖定計數，但**仍然必須通過 TOTP**（繞過的是鎖，不是驗證），
且每次使用都會寫入操作紀錄並推播 ntfy。

另外，鎖定只作用在登入端點 —— **已經登入的裝置完全不受影響**，
別人怎麼鎖都影響不到你手上那支已登入的手機。

## 備份

- 每日 03:00 以 SQLite 的 `VACUUM INTO` 產生乾淨快照到 `./backup/`，保留 14 份。
  （WAL 模式下不能只複製 `.sqlite3` 檔，最近的交易還在 `-wal` 裡。）
- `/api/export` 提供 JSON 匯出。對個人應用來說，一份人類可讀、與 schema 版本
  解耦的 JSON 比二進位快照更保險 —— 三年後想搬到別的工具時它還讀得懂。

## 疑難排解

**登入一直說驗證碼錯誤** —— TOTP 完全依賴時鐘。先看容器啟動時印的 `hostTime`：

```bash
docker compose logs app | grep 啟動完成
```

主機時間漂掉超過容差就會全部驗不過，而症狀看起來就像「密碼錯了」。確認 NTP 有在跑。

**看訪問紀錄與操作紀錄**

```bash
docker compose logs -f caddy    # 訪問紀錄（JSON，含真實訪客 IP）
docker compose logs -f app      # 應用日誌（JSON）
docker compose logs app | grep login
```

業務層的操作紀錄（誰在何時把哪一筆改成什麼，含變更前後值）在
「設定 → 操作紀錄」頁，保留天數可調。
