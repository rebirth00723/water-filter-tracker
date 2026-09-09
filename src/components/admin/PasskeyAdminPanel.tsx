'use client'

import { KeyRound, ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import { useAction } from 'next-safe-action/hooks'
import { toast } from 'sonner'
import {
  revokeAllCredentials,
  revokeCredential,
  setPasskeyGlobal,
} from '@/app/(app)/admin/actions'
import { actionErrorMessage } from '@/components/forms/action-feedback'
import { ConfirmButton } from '@/components/forms/ConfirmButton'
import { Badge, Button, Card, CheckboxRow, buttonClass } from '@/components/ui'

export interface AdminCredential {
  id: number
  deviceLabel: string | null
  /** 伺服端依 App 時區格式化好的字串 —— 客戶端自己轉會差一天，見 lib/date.ts */
  createdLabel: string
  lastUsedLabel: string | null
}

/**
 * admin 的 passkey 面板。
 *
 * 職責刻意只有兩件：**全域開關**（部署層級的決定，牽涉 PUBLIC_URL 與 https）
 * 與**緊急撤銷**（手機遺失那類情況）。
 * 日常的註冊、改名、刪自己那把在 `(app)/settings/login` ——
 * 兩邊做同樣的事只會讓人不知道該去哪一頁。
 */
export function PasskeyAdminPanel({
  passkey,
  credentials,
  openMode,
}: {
  passkey: { eligible: boolean; reason?: string; enabled: boolean }
  credentials: AdminCredential[]
  openMode: boolean
}) {
  const toggle = useAction(setPasskeyGlobal, {
    onSuccess: ({ data }) => toast.success(data.on ? '已啟用 passkey' : '已停用 passkey'),
    onError: ({ error }) => toast.error(actionErrorMessage(error), { duration: 10_000 }),
  })
  const revoke = useAction(revokeCredential, {
    onSuccess: ({ data }) => toast.success(`已撤銷「${data.label}」`),
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })
  const revokeAll = useAction(revokeAllCredentials, {
    onSuccess: ({ data }) => toast.success(`已撤銷全部 ${data.count} 把`),
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  const blocked = !passkey.eligible || openMode

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <KeyRound className="size-4" aria-hidden />
        passkey 快速登入
      </h2>
      <Card className="space-y-3 px-4 py-3.5">
        {/*
          條件不滿足時把開關顯示為停用並說明原因，
          而不是讓人打開之後才發現按鈕沒反應 —— 那會讓人以為系統壞了
        */}
        {blocked ? (
          <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5">
            <p className="text-xs font-medium text-warning">目前無法啟用</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {openMode
                ? '請先在下方設定密碼。passkey 綁定裝置與網域，裝置遺失或換網域時密碼是唯一的退路，所以它只能作為密碼之外的快捷方式。'
                : passkey.reason}
            </p>
          </div>
        ) : (
          <CheckboxRow
            label="啟用 passkey 快速登入"
            hint="開啟之後使用者可以到「設定 → 快速登入」自助註冊自己的裝置"
            checked={passkey.enabled}
            disabled={toggle.isPending}
            onChange={(e) => toggle.execute({ on: e.currentTarget.checked })}
          />
        )}

        {passkey.enabled && !blocked && (
          <p className="text-xs text-muted-foreground">
            日常的註冊與改名在{' '}
            <Link href="/settings/login" className="underline">
              設定 → 快速登入
            </Link>
            。這裡只放全域開關與緊急撤銷。
          </p>
        )}

        <div className="border-t border-border pt-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold">
            <ShieldAlert className="size-3.5" aria-hidden />
            已註冊的憑證（{credentials.length}）
          </h3>
          {credentials.length === 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">目前沒有任何 passkey。</p>
          ) : (
            <>
              <ul className="mt-2 space-y-1.5">
                {credentials.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {c.deviceLabel ?? '未命名裝置'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {c.createdLabel} 註冊
                        {c.lastUsedLabel ? ` · 上次使用 ${c.lastUsedLabel}` : ' · 還沒用過'}
                      </span>
                    </span>
                    <ConfirmButton
                      label="撤銷"
                      variant="ghost"
                      title={`撤銷「${c.deviceLabel ?? '未命名裝置'}」？`}
                      description="那台裝置之後不能再用 passkey 登入。這是給手機遺失這類情況用的 —— 日常的刪除請到「設定 → 快速登入」。"
                      pending={revoke.isPending}
                      onConfirm={() => revoke.execute({ id: c.id })}
                    />
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <ConfirmButton
                  label={`撤銷全部 ${credentials.length} 把`}
                  title="撤銷所有 passkey？"
                  description={
                    <>
                      所有裝置都會失去 passkey 登入，只能用密碼。
                      <br />
                      換網域之後既有的 passkey 本來就全部失效，那時用這個一次清乾淨最省事。
                    </>
                  }
                  confirmLabel="全部撤銷"
                  pending={revokeAll.isPending}
                  onConfirm={() => revokeAll.execute({})}
                />
              </div>
            </>
          )}
        </div>

        {!passkey.enabled && !blocked && credentials.length > 0 && (
          <p className="text-xs text-warning">
            開關已關閉，所以這 {credentials.length} 把憑證目前無法用於登入 ——
            但它們仍然保留著，重新開啟就會恢復。
          </p>
        )}

        <div>
          <Link href="/settings/login" className={buttonClass('secondary', 'sm')}>
            前往自助管理
          </Link>
        </div>
      </Card>
    </section>
  )
}
