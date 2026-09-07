import type { MetadataRoute } from 'next'

/**
 * PWA manifest。讓「加到主畫面」成立 ——
 * 手機優先的 App 靠它才像個 App：全螢幕、有圖示、從主畫面一點就進。
 *
 * `start_url` 用 `.`（相對於 manifest 所在位置）而不是寫死 `/`，
 * 這樣掛在子路徑下（BASE_PATH）也正確。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '淨水器記錄',
    short_name: '淨水器',
    description: '淨水器耗材更換與水質記錄',
    start_url: '.',
    display: 'standalone',
    background_color: '#f7f8fa',
    theme_color: '#0d7490',
    orientation: 'portrait',
    lang: 'zh-Hant-TW',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: 'icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
