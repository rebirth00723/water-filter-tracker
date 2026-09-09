'use client'

import { startRegistration } from '@simplewebauthn/browser'
import { KeyRound, Pencil, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useAction } from 'next-safe-action/hooks'
import { toast } from 'sonner'
import {
  removeMyCredential,
  renameMyCredential,
} from '@/app/(app)/settings/login/actions'
import { actionErrorMessage } from '@/components/forms/action-feedback'
import { ConfirmButton } from '@/components/forms/ConfirmButton'
import { Badge, Button, Card, EmptyState, Field, Input, buttonClass } from '@/components/ui'
import { Drawer } from '@/components/ui/Drawer'
import { withBasePath } from '@/lib/base-path'

export interface PasskeyRow {
  id: number
  deviceLabel: string | null
  /** 伺服端依 App 時區格式化好的字串 —— 客戶端自己轉會差一天，見 lib/date.ts */
  createdLabel: string
  lastUsedLabel: string | null
  transports: string[]
}

export interface PasskeyState {
  usable: boolean
  reason?: string
  rows: PasskeyRow[]
}

/**
 * 「快速登入」的自助管理。
 *
 * **註冊流程沒有任何 QR、沒有任何 token。** 你已經用密碼登入了 ——
 * 那就是授權。按一下、Face ID、完成。
 * 如果哪天這一頁出現了 QR 或一次性代碼，代表設計退回舊版，要停下來重看計畫。
 */
export function PasskeyManager({ state }: { state: PasskeyState }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<PasskeyRow | null>(null)
  const [label, setLabel] = useState('')

  const del = useAction(removeMyCredential, {
    onSuccess: ({ data }) => toast.success(`已刪除「${data.label}」`),
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })
  const rename = useAction(renameMyCredential, {
    onSuccess: ({ data }) => {
      toast.success(`已改名為「${data.label}」`)
      setRenaming(null)
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  async function register() {
    setBusy(true)
    try {
      // 第一次往返：拿伺服器產生的一次性挑戰
      const optRes = await fetch(withBasePath('/api/auth/passkey/register'))
      const optJson = (await optRes.json()) as
        | { ok: true; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }
        | { ok: false; message: string }
      if (!optJson.ok) return toast.error(optJson.message)

      // 瀏覽器呼叫驗證器（Face ID / Touch ID / 安全金鑰）。私鑰從不離開裝置
      const attestation = await startRegistration({ optionsJSON: optJson.options })

      // 第二次往返：把簽章送回去驗，伺服器只存下公鑰
      const verifyRes = await fetch(withBasePath('/api/auth/passkey/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: attestation }),
      })
      const verifyJson = (await verifyRes.json()) as
        | { ok: true; label: string }
        | { ok: false; message: string }
      if (!verifyJson.ok) return toast.error(verifyJson.message, { duration: 10_000 })

      toast.success(`已註冊「${verifyJson.label}」`, {
        description: '下次登入時可以直接用它，不必打密碼',
      })
      router.refresh()
    } catch (err) {
      const e = err as { name?: string; message?: string }
      // 使用者按取消不是錯誤，不該用紅色 toast 罵他
      if (e.name === 'NotAllowedError') {
        toast.info('已取消註冊')
        return
      }
      if (e.name === 'InvalidStateError') {
        toast.error('這台裝置的 passkey 已經註冊過了')
        return
      }
      toast.error(`註冊失敗：${e.message ?? '未知錯誤'}`, { duration: 10_000 })
    } finally {
      setBusy(false)
    }
  }

  if (!state.usable) {
    return (
      <Card className="border-warning/40 bg-warning/5 px-4 py-3.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-warning">
          <KeyRound className="size-4" aria-hidden />
          快速登入目前不可用
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{state.reason}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          HTTPS 與網域名稱不是本專案的要求，而是瀏覽器的要求 ——
          WebAuthn 在非安全內容下根本不存在，而 RP ID 不接受 IP 位址。
          <br />
          密碼在純 HTTP 下照常可用，所以區網直連時你不會被鎖在外面。
        </p>
        <div className="mt-3">
          <Link href="/admin" className={buttonClass('secondary', 'sm')}>
            前往管理中心
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 px-4 py-3.5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          用 Face ID、Touch ID 或安全金鑰登入，不必打密碼。
          <strong className="text-foreground">私鑰從不離開你的裝置</strong> ——
          伺服器只存公鑰，所以資料庫外洩也無法用來登入。
          <br />
          密碼仍然有效，而且是 passkey 失效時（換裝置、換網域、純 HTTP）的退路。
        </p>
        <Button disabled={busy} onClick={register}>
          <Plus className="size-4" aria-hidden />
          {busy ? '等待驗證器…' : '註冊這台裝置'}
        </Button>
      </Card>

      {state.rows.length === 0 ? (
        <EmptyState
          title="還沒有註冊任何裝置"
          description="按上面的按鈕，用這台裝置的生物辨識註冊一把。整個過程不需要 QR、不需要輸入任何代碼。"
        />
      ) : (
        <Card>
          <ul>
            {state.rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <KeyRound className="size-4 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {r.deviceLabel ?? '未命名裝置'}
                    </span>
                    {r.transports.includes('internal') && <Badge tone="muted">本機生物辨識</Badge>}
                    {r.transports.includes('hybrid') && <Badge tone="muted">跨裝置</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.createdLabel} 註冊
                    {r.lastUsedLabel ? ` · 上次使用 ${r.lastUsedLabel}` : ' · 還沒用過'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`重新命名 ${r.deviceLabel ?? '這把 passkey'}`}
                  onClick={() => {
                    setRenaming(r)
                    setLabel(r.deviceLabel ?? '')
                  }}
                >
                  <Pencil className="size-4" aria-hidden />
                </Button>
                <ConfirmButton
                  label="刪除"
                  variant="ghost"
                  title={`刪除「${r.deviceLabel ?? '未命名裝置'}」？`}
                  description={
                    <>
                      這台裝置之後不能再用 passkey 登入，但仍然可以用密碼。
                      {state.rows.length === 1 && (
                        <>
                          <br />
                          這是最後一把 passkey，刪掉之後就只剩密碼登入了。
                        </>
                      )}
                    </>
                  }
                  pending={del.isPending}
                  onConfirm={() => del.execute({ id: r.id })}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Drawer
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="重新命名"
        description="換裝置時看得出哪一把是哪一台"
      >
        {renaming && (
          <form
            className="space-y-4 pt-2"
            onSubmit={(e) => {
              e.preventDefault()
              rename.execute({ id: renaming.id, label })
            }}
          >
            <Field label="名稱" htmlFor="pk-label" required>
              <Input
                id="pk-label"
                value={label}
                autoComplete="off"
                onChange={(e) => setLabel(e.currentTarget.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setRenaming(null)}
              >
                取消
              </Button>
              <Button type="submit" className="flex-1" disabled={rename.isPending}>
                {rename.isPending ? '儲存中…' : '儲存'}
              </Button>
            </div>
          </form>
        )}
      </Drawer>
    </div>
  )
}
