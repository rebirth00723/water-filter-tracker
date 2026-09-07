'use client'

import { Download, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, CheckboxRow, Field } from '@/components/ui'
import { withBasePath } from '@/lib/base-path'

type Mode = 'replace' | 'merge'

/**
 * JSON 匯出與匯入。
 *
 * 匯入是這個 App 唯一能一次改寫全部資料的操作，所以確認流程刻意麻煩：
 * 要選模式、要勾一個「我知道會發生什麼」的核取方塊，按鈕才會啟用。
 * 這不是為了儀式感 —— 取代模式會清空現有紀錄，而那沒有 undo。
 */
export function DataTransfer() {
  const [mode, setMode] = useState<Mode>('merge')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return toast.error('請選擇要匯入的 JSON 檔案')

    setBusy(true)
    setResult(null)
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('mode', mode)
      const res = await fetch(withBasePath('/api/import'), { method: 'POST', body })
      const json = (await res.json()) as
        | { ok: true; devices: number; categories: number; items: number; events: number; readings: number; skipped: string[] }
        | { ok: false; message: string }

      if (!json.ok) {
        toast.error(json.message)
        return
      }
      toast.success(`匯入完成：${json.devices} 台設備、${json.events} 筆耗材紀錄`)
      setResult([
        `${json.devices} 台設備`,
        `${json.categories} 個種類`,
        `${json.items} 項耗材`,
        `${json.events} 筆耗材紀錄`,
        `${json.readings} 筆水質紀錄`,
        ...json.skipped.map((s) => `略過：${s}`),
      ])
      setUnderstood(false)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      toast.error(`匯入失敗：${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm font-semibold">匯出</h2>
        <Card className="space-y-3 px-4 py-3.5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            單一 JSON 檔，人類可讀。含設備、種類、耗材、耗材紀錄、水質紀錄、通知規則與偏好設定。
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">刻意不含</strong>登入憑證、passkey、操作紀錄，
            以及 ntfy 的連線與認證。passkey 綁定網域，換機器就失效；
            而能匯入他人憑證檔的功能等於一條後門。ntfy 的認證匯出去只會變成外洩。
          </p>
          {/* 用 <a download> 而不是 fetch + blob：伺服器已經設好 Content-Disposition，
              讓瀏覽器自己處理下載最不容易出錯 */}
          <a
            href={withBasePath('/api/export')}
            download
            className="inline-flex h-11 items-center gap-2 rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-muted"
          >
            <Download className="size-4" aria-hidden />
            下載 JSON
          </a>
          <p className="text-xs text-muted-foreground">
            這不是備份機制。資料就是 <code>./data/app.sqlite3</code> 一個檔，
            備份請用 NAS 快照或 rsync ——{' '}
            <strong className="text-warning">但容器執行中不能直接複製那個檔</strong>，
            最近的交易還在 <code>-wal</code> 裡。
          </p>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-destructive">匯入</h2>
        <Card className="border-destructive/30 px-4 py-3.5">
          <form onSubmit={submit} className="space-y-4">
            <Field label="JSON 檔案" htmlFor="import-file" required>
              <input
                ref={fileRef}
                id="import-file"
                type="file"
                accept="application/json,.json"
                required
                className="block w-full text-sm file:mr-3 file:h-11 file:rounded-md file:border
                           file:border-input file:bg-card file:px-3 file:text-sm"
              />
            </Field>

            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-medium">模式</legend>
              {(
                [
                  {
                    v: 'merge' as const,
                    label: '合併',
                    hint: '把檔案裡的設備當成新設備加進來，現有資料不動。用於把兩台機器的紀錄併成一份。通知規則與偏好設定會保留這台機器自己的',
                  },
                  {
                    v: 'replace' as const,
                    label: '取代',
                    hint: '先清空現有的設備、種類、耗材與所有紀錄，再匯入。用於遷移到新機器。無法復原',
                  },
                ]
              ).map((o) => (
                <label
                  key={o.v}
                  className={`block cursor-pointer rounded-md border px-3 py-2.5 ${
                    mode === o.v ? 'border-primary bg-accent' : 'border-input'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="mode"
                      value={o.v}
                      checked={mode === o.v}
                      onChange={() => {
                        setMode(o.v)
                        // 換模式就要重新確認 —— 後果不一樣
                        setUnderstood(false)
                      }}
                      className="size-4"
                    />
                    <span className="text-sm font-medium">{o.label}</span>
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {o.hint}
                  </span>
                </label>
              ))}
            </fieldset>

            <CheckboxRow
              label={
                mode === 'replace'
                  ? '我知道這會清空現有的所有紀錄，且無法復原'
                  : '我知道這會把檔案裡的設備當成新設備加進來'
              }
              checked={understood}
              onChange={(e) => setUnderstood(e.currentTarget.checked)}
              className={mode === 'replace' ? 'border-destructive/40' : undefined}
            />

            <Button type="submit" variant="destructive" disabled={!understood || busy}>
              <Upload className="size-4" aria-hidden />
              {busy ? '匯入中…' : mode === 'replace' ? '清空並匯入' : '合併匯入'}
            </Button>

            <p className="text-xs text-muted-foreground">
              整個匯入在一個 transaction 裡執行，中途失敗會完整回滾，不會留下半套資料。
            </p>
          </form>

          {result && (
            <div className="mt-4 rounded-md bg-muted px-3 py-2.5">
              <p className="text-xs font-medium">匯入結果</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {result.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </section>
    </div>
  )
}
