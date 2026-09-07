import { NextResponse } from 'next/server'

/** 去掉尾端斜線的 BASE_PATH，空字串代表掛在根目錄 */
export const BASE_PATH = (process.env.BASE_PATH ?? '').trim().replace(/\/+$/, '')

/**
 * 表單 POST 之後的 303 導向。
 *
 * **`Location` 一律用相對路徑，不組絕對網址。** 這不是風格偏好：
 * `new URL(path, req.url)` 在 Next standalone 下會把 `req.url` 解析成
 * `http://localhost:<PORT>`，**而且不管實際的 Host header 是什麼**。後果有兩層：
 *
 * 1. 部署在 `https://water.example.com` 時，登入成功會把瀏覽器導去
 *    `http://localhost:8085/` —— 使用者那端根本連不到。
 * 2. 即使在本機，用 `127.0.0.1` 開頁面而導向 `localhost` 就是跨來源，
 *    會被 CSP 的 `form-action 'self'` 直接擋掉整個表單送出。
 *
 * 相對路徑由瀏覽器對當前網址解析，因此不需要信任任何 Host 或 X-Forwarded-* header，
 * 在 tunnel、反向代理與直連下全部自動正確。
 *
 * RFC 7231 §7.1.2 明文允許相對的 Location（RFC 2616 曾要求絕對，早已被取代）。
 */
export function seeOther(path: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: withBasePath(path) },
  })
}

/**
 * 掛在子路徑下時（`BASE_PATH=/water`）要自己補前綴。
 *
 * `next/link`、`redirect()` 與 `NextResponse.redirect()` 都會自動處理 basePath，
 * 但這裡是手工組出來的 Response，Next 沒有機會插手 —— 漏掉的話子路徑部署會導到
 * 網域根目錄，而那底下通常是另一個服務。
 */
export function withBasePath(path: string): string {
  if (!BASE_PATH || !path.startsWith('/')) return path
  return `${BASE_PATH}${path}`
}
