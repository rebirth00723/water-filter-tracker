'use client'

import { AlertTriangle, Bell, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAction } from 'next-safe-action/hooks'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import {
  removeNotifyRule,
  saveNotifyPrefs,
} from '@/app/(app)/settings/notifications/actions'
import { actionErrorMessage } from '@/components/forms/action-feedback'
import { ConfirmButton } from '@/components/forms/ConfirmButton'
import { FormActions, FormError } from '@/components/forms/FormShell'
import { Badge, Button, Card, EmptyState, Field, Input } from '@/components/ui'
import { Drawer } from '@/components/ui/Drawer'
import type { notifyRules } from '@/lib/db/schema'
import { SAMPLE_VARS, renderTemplate } from '@/lib/notify/template'
import { notifyPrefs } from '@/lib/schemas/notify'
import { NotifyRuleForm } from './NotifyRuleForm'

type Rule = typeof notifyRules.$inferSelect
type PrefsIn = z.input<typeof notifyPrefs>

export interface FailedNotification {
  id: number
  dueOn: string
  kind: string
  attempts: number
  lastError: string | null
  categoryName: string | null
}

export function NotifySettings({
  rules,
  prefs,
  failed,
  ntfyReady,
}: {
  rules: Rule[]
  prefs: { sendTime: string; catchupMaxDays: string; auditKeepDays: string }
  failed: FailedNotification[]
  ntfyReady: boolean
}) {
  const [editing, setEditing] = useState<Rule | null>(null)
  const [adding, setAdding] = useState(false)

  const del = useAction(removeNotifyRule, {
    onSuccess: () => toast.success('已刪除規則'),
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  const prefsForm = useForm<PrefsIn, unknown, PrefsIn>({
    resolver: zodResolver(notifyPrefs, undefined, { raw: true }),
    defaultValues: {
      sendTime: prefs.sendTime,
      catchupMaxDays: prefs.catchupMaxDays,
      auditKeepDays: prefs.auditKeepDays,
    },
  })
  const savePrefs = useAction(saveNotifyPrefs, {
    onSuccess: () => toast.success('已儲存'),
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  return (
    <div className="space-y-6">
      {!ntfyReady && (
        <Card className="border-warning/40 bg-warning/10 px-4 py-3.5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
            <AlertTriangle className="size-4" aria-hidden />
            通知目前是停用狀態
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            還沒設定 ntfy 伺服器或濾心提醒 topic。到管理中心填好之後這裡的規則才會生效 ——
            沒設定不會影響 App 的其他功能，只是不會有推播。
          </p>
        </Card>
      )}

      {/* 失敗的通知標紅。送不出去的通知不會再用推播告知 —— 推播本身就是壞掉的那一環 */}
      {failed.length > 0 && (
        <Card className="border-destructive/40 px-4 py-3.5">
          <h2 className="text-sm font-semibold text-destructive">
            {failed.length} 則通知送不出去
          </h2>
          <ul className="mt-2 space-y-1.5">
            {failed.map((f) => (
              <li key={f.id} className="text-xs">
                <span className="font-medium">
                  {f.categoryName ?? '(種類已刪除)'} · {f.dueOn} · {f.kind}
                </span>
                <span className="ml-1 text-muted-foreground">
                  （第 {f.attempts} 次嘗試{f.attempts >= 5 ? '，已停止重試' : ''}）
                </span>
                {f.lastError && (
                  <p className="mt-0.5 text-muted-foreground">{f.lastError}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            這些不會用推播告知你 —— 推播就是壞掉的那一環。修好連線設定之後，
            下一次掃描會自動撿回重試，超過 5 次才停止。
          </p>
        </Card>
      )}

      <section>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">通知規則</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              每一條各自決定提前幾天、什麼時刻送、用什麼語氣
            </p>
          </div>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
            新增
          </Button>
        </div>

        {rules.length === 0 ? (
          <EmptyState
            title="沒有通知規則"
            description="沒有規則就不會有任何提醒。建議至少一條「到期前 14 天」與一條逾期提醒。"
            action={<Button onClick={() => setAdding(true)}>新增第一條</Button>}
          />
        ) : (
          <div className="space-y-2">
            {rules.map((r) => (
              <Card key={r.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <Bell
                    className={`mt-0.5 size-4 shrink-0 ${r.enabled ? 'text-primary' : 'text-muted-foreground'}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {r.kind === 'ADVANCE'
                          ? r.offsetDays === 0
                            ? '當天到期'
                            : `到期前 ${r.offsetDays} 天`
                          : `逾期後每 ${r.repeatDays} 天`}
                      </span>
                      {!r.enabled && <Badge tone="muted">停用</Badge>}
                      <Badge tone={r.priority >= 4 ? 'warning' : 'muted'}>
                        優先度 {r.priority}
                      </Badge>
                      <Badge tone="muted">{r.sendTime ?? prefs.sendTime}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {renderTemplate(r.template, SAMPLE_VARS)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="編輯規則"
                      onClick={() => setEditing(r)}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <ConfirmButton
                      label="刪除"
                      variant="ghost"
                      title="刪除這條通知規則？"
                      description="會連帶清除它的送出紀錄。留著指向已刪規則的紀錄只會讓失敗清單出現無法重試也無法理解的項目。"
                      pending={del.isPending}
                      onConfirm={() => del.execute({ id: r.id })}
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">全域偏好</h2>
        <Card className="px-4 py-3.5">
          <form
            noValidate
            className="space-y-4"
            onSubmit={prefsForm.handleSubmit((v) => savePrefs.execute(v))}
          >
            <Field
              label="預設發送時刻"
              htmlFor="pref-time"
              required
              error={prefsForm.formState.errors.sendTime?.message}
              hint="沒有自訂時刻的規則會用這個。掃描每 15 分鐘一次，到了這個鐘點才真的送出"
            >
              <Input id="pref-time" type="time" {...prefsForm.register('sendTime')} />
            </Field>

            <Field
              label="補送上限（天）"
              htmlFor="pref-catchup"
              required
              error={prefsForm.formState.errors.catchupMaxDays?.message}
              hint="機器關機超過這個天數才到期的項目不逐一補送，改發一則彙總 —— 否則開機瞬間會被幾十則通知轟炸"
            >
              <Input
                id="pref-catchup"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                className="tabular"
                {...prefsForm.register('catchupMaxDays')}
              />
            </Field>

            <Field
              label="操作紀錄保留天數"
              htmlFor="pref-audit"
              required
              error={prefsForm.formState.errors.auditKeepDays?.message}
              hint="每天凌晨清理一次超過期限的紀錄"
            >
              <Input
                id="pref-audit"
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                className="tabular"
                {...prefsForm.register('auditKeepDays')}
              />
            </Field>

            <FormError message={savePrefs.result?.serverError} />
            <FormActions pending={savePrefs.isPending} submitLabel="儲存偏好" />
          </form>
        </Card>
      </section>

      <Drawer open={adding} onOpenChange={setAdding} title="新增通知規則">
        <NotifyRuleForm onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
      </Drawer>
      <Drawer
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title="編輯通知規則"
      >
        {editing && (
          <NotifyRuleForm
            rule={editing}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Drawer>
    </div>
  )
}
