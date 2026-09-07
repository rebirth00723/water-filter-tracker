'use client'

import { Download, QrCode } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card } from '@/components/ui'

/**
 * 設備專屬 QR Code 產生器。
 *
 * **完全在用戶端用 canvas 畫。** 不走伺服端的影像函式庫（sharp、canvas 那類
 * 原生相依在容器裡很容易出問題，而且要為 arm64/amd64 各準備一份），
 * 中文也直接用系統字體算繪 —— 伺服端要處理中文字型還得自己塞字型檔進映像。
 *
 * **圖片裡會燒進設備名稱。** 貼三張標籤在三台機器上時，
 * 沒有名稱根本分不出哪張是哪台 —— 而那正是這個功能存在的情境。
 */
export function DeviceQrCard({
  deviceName,
  url,
  fallbackPath,
}: {
  deviceName: string
  /** 完整網址。沒設 PUBLIC_URL 時為 null */
  url: string | null
  /** 沒有完整網址時顯示的相對路徑 */
  fallbackPath: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!url) return
    let cancelled = false

    ;(async () => {
      try {
        // 延遲載入：qrcode 只有這一頁需要，不該進到其他頁面的 bundle
        const QR = (await import('qrcode')).default
        if (cancelled) return

        const size = 512
        const pad = 32
        const captionH = 96
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = size + pad * 2
        canvas.height = size + pad * 2 + captionH

        const ctx = canvas.getContext('2d')!
        // 白底：QR 需要高對比，而且列印出來也是白紙
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        const qrCanvas = document.createElement('canvas')
        await QR.toCanvas(qrCanvas, url, {
          width: size,
          margin: 0,
          // 中等容錯：貼在機器上會被水氣與刮痕影響
          errorCorrectionLevel: 'M',
          color: { dark: '#000000ff', light: '#ffffffff' },
        })
        ctx.drawImage(qrCanvas, pad, pad, size, size)

        ctx.fillStyle = '#000000'
        ctx.textAlign = 'center'
        ctx.font =
          '600 44px -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif'
        ctx.fillText(deviceName, canvas.width / 2, size + pad + 56, canvas.width - pad * 2)

        ctx.fillStyle = '#555555'
        ctx.font = '24px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.fillText(url, canvas.width / 2, size + pad + 96, canvas.width - pad * 2)

        if (!cancelled) setReady(true)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [url, deviceName])

  function download() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return toast.error('產生圖片失敗')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      // 檔名用設備名稱，下載後不必再自己命名
      a.download = `${deviceName}-qr.png`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success('已下載 QR Code')
    }, 'image/png')
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">專屬連結與 QR Code</h2>
      <Card className="space-y-3 px-4 py-3.5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          這台設備的記錄頁網址。印一張貼在機器上，掃了直接進到這一台 ——
          不必記網址、不必先切換設備，也不必裝 App。
        </p>
        <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
          {url ?? fallbackPath}
        </code>

        {url === null ? (
          <p className="text-xs text-warning">
            尚未設定對外網址，所以無法產生 QR Code。到管理中心填入對外網址後就會出現。
            <br />
            網址刻意由伺服器組好而不是從瀏覽器當下的位址推導 ——
            從區網 IP 開這一頁時推導出來的會是一個掃了進不去的 QR。
          </p>
        ) : error ? (
          <p role="alert" className="text-xs text-destructive">
            產生 QR Code 失敗：{error}
          </p>
        ) : (
          <>
            <div className="flex justify-center">
              <canvas
                ref={canvasRef}
                aria-label={`${deviceName} 的 QR Code`}
                className="h-auto w-full max-w-56 rounded-md border border-border"
              />
            </div>
            <Button variant="secondary" size="sm" disabled={!ready} onClick={download}>
              <Download className="size-4" aria-hidden />
              {ready ? '下載 PNG' : '產生中…'}
            </Button>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <QrCode className="size-3.5" aria-hidden />
              圖片裡含設備名稱，貼多台時分得出哪張是哪台
            </p>
          </>
        )}
      </Card>
    </section>
  )
}
