import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

/**
 * Server Action 的 CSRF 檢查：Next 會比對請求的 Origin 與 Host（或 X-Forwarded-Host）。
 *
 * 反向代理／tunnel 只要不改寫 Host，這個比對天生就會通過，`allowedOrigins` 可以留空
 * —— 這正是計畫要求 cloudflared 不要設 `httpHostHeader` 的原因。
 *
 * 這裡只從 `PUBLIC_URL` 推導，不另設一個 `ALLOWED_ORIGINS` 環境變數：
 * 多一個變數就多一個能填錯又不會報錯的地方。
 *
 * 注意：組態在啟動時載入，讀不到資料庫，所以在管理中心填的 publicUrl 不會出現在這裡。
 * 那個情境本來就不需要它 —— 需要它的前提是代理改寫了 Host，
 * 而會那樣部署的人本來就會用環境變數做宣告式設定。
 */
function allowedOrigins(): string[] {
  const raw = process.env.PUBLIC_URL?.trim()
  if (!raw) return []
  try {
    // allowedOrigins 比對的是 host（含連接埠），不含協定與路徑
    return [new URL(raw).host]
  } catch {
    // 這裡不能 throw：組態載入失敗會讓整個服務起不來，
    // 而一個填錯的網址不該有這種殺傷力。實際的驗證在 config.ts。
    return []
  }
}

/**
 * 掛在子路徑下（`BASE_PATH=/water`），用於同一個網域上路徑撞名的情況 ——
 * 與 Grafana 的 `root_url` 同一個思路。
 *
 * 只能是環境變數：Next 必須在讀資料庫之前就決定要掛在哪個前綴，
 * 所以這一項與 PORT 一樣不進 machine_config。
 */
const basePath = (process.env.BASE_PATH ?? '').trim().replace(/\/+$/, '')

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),

  /*
   * 把 basePath 也注入客戶端 bundle。
   *
   * **必要，不是方便。** `next/link` 會自動處理 basePath，但**原始的 `fetch()`
   * 與 `<a href>` 不會** —— 那是瀏覽器 API，Next 沒有機會插手。
   * 匯入用 fetch('/api/import')、匯出用 <a href="/api/export">，
   * 少了前綴在子路徑部署下會打到 404，而且症狀是「按了沒反應」。
   *
   * 從同一個 basePath 變數推導，所以不可能與伺服端不一致。
   */
  env: { NEXT_PUBLIC_BASE_PATH: basePath },

  // 明確釘住專案根目錄：否則 Turbopack 會往上找到家目錄的 lockfile
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },

  // 容器部署：只打包 runtime 需要的檔案，產出 .next/standalone/server.js
  output: 'standalone',

  // better-sqlite3 已在 Next 的預設外部套件清單中，原生模組不會被打包，
  // 由 output tracing 連同 prebuilds/*.node 一起搬進 standalone —— 實測確認過。
  // croner 是純 JS，讓它正常被打包即可，單一實例由 boot() 的 globalThis 旗標保證。

  experimental: {
    serverActions: { allowedOrigins: allowedOrigins() },
  },
}

export default nextConfig
