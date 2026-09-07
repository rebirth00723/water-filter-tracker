/**
 * BASE_PATH 的純處理，**不匯入 next/server** ——
 * 客戶端要用 `withBasePath()` 組出 fetch 與 `<a href>` 的網址，
 * 而 `lib/http.ts` 匯入了 NextResponse，把它拉進瀏覽器 bundle 會失敗。
 *
 * 讀的是 `NEXT_PUBLIC_BASE_PATH`（由 next.config.ts 從同一個 basePath 變數注入），
 * 因為 `process.env.BASE_PATH` 在客戶端讀不到 —— Next 只把 NEXT_PUBLIC_ 開頭的
 * 內聯進 bundle。
 *
 * **為什麼客戶端非補不可**：`next/link` 會自動處理 basePath，
 * 但原始的 `fetch()` 與 `<a href>` 是瀏覽器 API，Next 沒有機會插手。
 * 少了前綴，子路徑部署下匯出匯入會打到 404，症狀是「按了沒反應」。
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim().replace(/\/+$/, '')

export function withBasePath(path: string): string {
  if (!BASE_PATH || !path.startsWith('/')) return path
  return `${BASE_PATH}${path}`
}
