import { NextResponse } from 'next/server'
import { BASE_PATH, withBasePath } from './base-path'

export { BASE_PATH, withBasePath } from './base-path'

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

