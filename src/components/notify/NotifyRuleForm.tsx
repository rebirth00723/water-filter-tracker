'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useAction } from 'next-safe-action/hooks'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import {
  addNotifyRule,
  editNotifyRule,
} from '@/app/(app)/settings/notifications/actions'
import { actionErrorMessage } from '@/components/forms/action-feedback'
import { FormActions, FormError } from '@/components/forms/FormShell'
import { CheckboxRow, Field, Input, Select, Textarea } from '@/components/ui'
import type { notifyRules } from '@/lib/db/schema'
import { SAMPLE_VARS, renderTemplate, templateVariables } from '@/lib/notify/template'
import { notifyRuleFormSchema } from '@/lib/schemas/notify'

type In = z.input<typeof notifyRuleFormSchema>
type Rule = typeof notifyRules.$inferSelect

export function NotifyRuleForm({
  rule,
  onDone,
  onCancel,
}: {
  rule?: Rule
  onDone?: () => void
  onCancel?: () => void
}) {
  const editing = rule !== undefined
  const uid = useId()
  const fid = (n: string) => `${uid}-${n}`

  const form = useForm<In, unknown, In>({
    resolver: zodResolver(notifyRuleFormSchema, undefined, { raw: true }),
    defaultValues: {
      kind: rule?.kind ?? 'ADVANCE',
      offsetDays: rule?.offsetDays != null ? String(rule.offsetDays) : '14',
      repeatDays: rule?.repeatDays != null ? String(rule.repeatDays) : '7',
      template: rule?.template ?? '{device} 的{category}再 {days} 天就該換了（預計 {dueOn}）',
      priority: rule?.priority ?? 3,
      sendTime: rule?.sendTime ?? '',
      enabled: rule?.enabled ?? true,
    },
  })

  const onError = ({ error }: { error: Parameters<typeof actionErrorMessage>[0] }) =>
    toast.error(actionErrorMessage(error))

  const create = useAction(addNotifyRule, {
    onSuccess: () => {
      toast.success('已新增通知規則')
      onDone?.()
    },
    onError,
  })
  const update = useAction(editNotifyRule, {
    onSuccess: () => {
      toast.success('已更新通知規則')
      onDone?.()
    },
    onError,
  })
  const run = editing ? update : create

  const kind = form.watch('kind')
  const template = form.watch('template')
  const preview = (() => {
    try {
      return renderTemplate(template ?? '', SAMPLE_VARS)
    } catch {
      return ''
    }
  })()

  return (
    <form
      noValidate
      className="space-y-4 pt-2"
      onSubmit={form.handleSubmit((values) =>
        editing ? update.execute({ ...values, id: rule.id }) : create.execute(values),
      )}
    >
      <Field label="類型" htmlFor={fid('kind')} required>
        <Select id={fid('kind')} {...form.register('kind')}>
          <option value="ADVANCE">提前提醒 —— 到期前幾天送一次</option>
          <option value="OVERDUE">逾期提醒 —— 逾期後每幾天重送</option>
        </Select>
      </Field>

      {kind === 'ADVANCE' ? (
        <Field
          label="提前天數"
          htmlFor={fid('offset')}
          required
          error={form.formState.errors.offsetDays?.message}
          hint="0 代表當天到期才提醒"
        >
          <Input
            id={fid('offset')}
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            className="tabular"
            {...form.register('offsetDays')}
          />
        </Field>
      ) : (
        <Field
          label="重發間隔（天）"
          htmlFor={fid('repeat')}
          required
          error={form.formState.errors.repeatDays?.message}
          hint="逾期後每幾天再提醒一次。要停就把整條規則停用"
        >
          <Input
            id={fid('repeat')}
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            className="tabular"
            {...form.register('repeatDays')}
          />
        </Field>
      )}

      <Field
        label="訊息內容"
        htmlFor={fid('template')}
        required
        error={form.formState.errors.template?.message}
      >
        <Textarea id={fid('template')} rows={3} {...form.register('template')} />
      </Field>

      <div className="rounded-md bg-muted px-3 py-2.5">
        <p className="text-xs font-medium">預覽</p>
        <p className="mt-1 text-sm">{preview || '（空白）'}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {templateVariables().map((v) => (
            <div key={v.name} className="col-span-2 flex gap-2">
              <dt className="font-mono">{v.name}</dt>
              <dd>{v.desc}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="優先度"
          htmlFor={fid('priority')}
          error={form.formState.errors.priority?.message}
          hint="ntfy 的 1–5"
        >
          <Select id={fid('priority')} {...form.register('priority')}>
            <option value="1">1 · 最低</option>
            <option value="2">2 · 低</option>
            <option value="3">3 · 一般</option>
            <option value="4">4 · 高（會震動）</option>
            <option value="5">5 · 最高（會持續響）</option>
          </Select>
        </Field>
        <Field
          label="發送時刻"
          htmlFor={fid('sendTime')}
          error={form.formState.errors.sendTime?.message}
          hint="留空＝沿用全域"
        >
          <Input id={fid('sendTime')} type="time" {...form.register('sendTime')} />
        </Field>
      </div>

      <CheckboxRow
        label="啟用"
        hint="停用後這條規則不再產生通知，設定會保留"
        {...form.register('enabled')}
      />

      <FormError message={run.result?.serverError} />
      <FormActions
        pending={run.isPending}
        submitLabel={editing ? '儲存' : '新增規則'}
        onCancel={onCancel}
      />
    </form>
  )
}
