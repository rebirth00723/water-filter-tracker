import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '淨水器記錄',
  description: '淨水器耗材更換與水質記錄',
  appleWebApp: { capable: true, title: '淨水器記錄', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  // 沒有這行，底部導覽列的 env(safe-area-inset-bottom) 會永遠解析成 0
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1214' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-Hant-TW" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  )
}
