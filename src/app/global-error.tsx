'use client'

/**
 * 最後一道防線：根 layout 自己爆掉時才會走到這裡。
 *
 * 它**取代**根 layout，所以必須自己輸出 `<html>` 與 `<body>`；
 * 而且 Next 不會把 globals.css 帶進來 —— 樣式只能寫成 inline style，
 * 用 Tailwind class 的話這一頁會是一片未套用樣式的白底黑字。
 *
 * 同理，App 的主題（class / data-theme）到不了這裡，
 * 只有作業系統的 prefers-color-scheme 有效，所以用 `color-scheme: light dark`
 * 搭配 `canvas` / `canvastext` 這兩個系統色關鍵字，
 * 讓暗色模式下不會是刺眼的白底。
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="zh-Hant-TW">
      <body
        style={{
          colorScheme: 'light dark',
          background: 'canvas',
          color: 'canvastext',
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.25rem',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif',
        }}
      >
        <title>出了點問題 — 淨水器記錄</title>
        <main style={{ maxWidth: '24rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.75rem' }}>
            出了點問題
          </h1>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.7, margin: '0 0 1rem', opacity: 0.8 }}>
            服務發生未預期的錯誤。再試一次通常就好；若一直如此，請看容器日誌。
          </p>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', opacity: 0.65, margin: '0 0 1.25rem' }}>
              錯誤代碼 <code style={{ fontFamily: 'ui-monospace, monospace' }}>{error.digest}</code>
            </p>
          )}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              height: '3rem',
              width: '100%',
              borderRadius: '0.375rem',
              border: '1px solid currentColor',
              background: 'transparent',
              color: 'inherit',
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            再試一次
          </button>
        </main>
      </body>
    </html>
  )
}
