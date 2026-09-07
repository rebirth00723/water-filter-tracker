import { headers } from 'next/headers'

/**
 * 取得真實訪客 IP。
 *
 * 【僅供記錄與稽核使用，不參與限流】—— 限流只綁帳號。
 * 因此這裡即使被偽造也不影響安全性，只影響 log 的可信度。
 *
 * 值可不可信取決於部署方式（走 tunnel 時 CF-Connecting-IP 由 Cloudflare 邊緣附加，
 * 直接對外發布連接埠時則完全可偽造）—— 但因為它不參與授權，
 * 所以「可不可信」只影響日誌的可信度，不影響安全性。
 */
export async function clientIp(): Promise<string> {
  const h = await headers()
  const cf = h.get('cf-connecting-ip')?.trim()
  if (cf) return cf

  const xff = h.get('x-forwarded-for')
  if (xff) {
    // 最右邊是「最靠近我們的那層代理所填的值」，是整條鏈上唯一不可偽造的一段
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    const last = parts.at(-1)
    if (last) return last
  }
  return 'unknown'
}

export async function userAgent(): Promise<string> {
  return (await headers()).get('user-agent')?.slice(0, 300) ?? ''
}
