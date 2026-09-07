'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useAction } from 'next-safe-action/hooks'
import { useId } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import { addCategory, deactivateCovered, editCategory } from '@/app/(app)/settings/devices/actions'
import { CheckboxRow, Field, Input, Select } from '@/components/ui'
import type { Category } from '@/lib/settings-store'
import { categoryFields, categoryFormSchema } from '@/lib/schemas/settings'
import { actionErrorMessage } from './action-feedback'
import { ColorPicker } from './ColorPicker'
import { FormActions, FormError } from './FormShell'

type In = z.input<typeof categoryFields>

export function CategoryForm({
  deviceId,
  category,
  onDone,
  onCancel,
}: {
  deviceId: number
  category?: Category
  onDone?: () => void
  onCancel?: () => void
}) {
  const editing = category !== undefined
  // 同一個表單可能同時掛載多份，id 必須每個實例唯一（見 DeviceForm 的說明）
  const uid = useId()
  const fid = (name: string) => `${uid}-${name}`

  const form = useForm<In, unknown, In>({
    resolver: zodResolver(categoryFormSchema, undefined, { raw: true }),
    defaultValues: {
      name: category?.name ?? '',
      color: category?.color ?? '#14b8a6',
      // 數字欄位以字串為輸入型別，null 對應空字串（＝不設週期）
      cyclePeriod: category?.cyclePeriod != null ? String(category.cyclePeriod) : '',
      cycleUnit: category?.cycleUnit ?? 'MONTH',
      baselineOn: category?.baselineOn ?? '',
      notifyEnabled: category?.notifyEnabled ?? true,
      active: category?.active ?? true,
    },
  })

  /**
   * 啟用一個合併種類（例如第二三道）之後，問要不要一併停用被涵蓋的那幾道。
   *
   * 刻意是「問」而不是自動做 —— `coversStages` 只用來產生這個提示，
   * 不做覆蓋關係的圖遍歷，否則「換第二三道要點亮幾條泳道」會變成無解的歧義。
   */
  const covered = useAction(deactivateCovered, {
    onSuccess: ({ data }) => {
      if (data.count > 0) toast.success(`已停用${data.names.join('、')}`)
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  function offerToDeactivateCovered(id: number, name: string) {
    if (!category?.coversStages && !editing) return
    const covers = category?.coversStages
    if (!covers) return
    toast(`「${name}」涵蓋了其他道`, {
      description: '要一併停用被它涵蓋的那幾道嗎？',
      action: { label: '一併停用', onClick: () => covered.execute({ id }) },
      duration: 10_000,
    })
  }

  const create = useAction(addCategory, {
    onSuccess: ({ data }) => {
      toast.success(`已新增種類「${data.name}」`)
      form.reset()
      onDone?.()
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })
  const update = useAction(editCategory, {
    onSuccess: ({ data }) => {
      toast.success(`已更新「${data.name}」`)
      if (form.getValues('active')) offerToDeactivateCovered(data.id, data.name)
      onDone?.()
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  const run = editing ? update : create
  const cycleUnit = form.watch('cycleUnit')

  return (
    <form
      /*
       * `noValidate` 讓 zod 成為唯一的驗證權威。
       *
       * 不關掉原生驗證的話會有兩套規則，而**原生那套會靜默勝出**：
       * `requestSubmit()` 遇到不合 min/max 的值時連 submit 事件都不會發，
       * 使用者看到的是瀏覽器的預設氣泡（非中文、樣式不受控），
       * 而我寫的中文訊息與跨欄位檢查根本沒機會執行。
       *
       * min/max 仍然保留在 input 上 —— 它們對手機鍵盤與數字步進器有用。
       */
      noValidate
      className="space-y-4 pt-2"
      onSubmit={form.handleSubmit((values) =>
        editing ? update.execute({ ...values, id: category.id }) : create.execute({ ...values, deviceId }),
      )}
    >
      <Field label="種類名稱" htmlFor={fid('name')} required error={form.formState.errors.name?.message}>
        <Input id={fid('name')} autoComplete="off" placeholder="第一道" {...form.register('name')} />
      </Field>

      <Field label="顏色" error={form.formState.errors.color?.message}>
        <Controller
          control={form.control}
          name="color"
          render={({ field }) => (
            <ColorPicker value={field.value ?? '#14b8a6'} onChange={field.onChange} />
          )}
        />
      </Field>

      <Field
        label="更換週期"
        error={form.formState.errors.cyclePeriod?.message}
        hint={
          form.watch('cyclePeriod')
            ? undefined
            : '留空＝不設週期。不設的話這個種類不會有到期日，也不會發提醒'
        }
      >
        <div className="flex gap-2">
          <Input
            id={fid('cycle')}
            type="number"
            inputMode="numeric"
            min={1}
            max={cycleUnit === 'DAY' ? 3650 : 120}
            placeholder="不設"
            className="flex-1"
            {...form.register('cyclePeriod')}
          />
          <Select aria-label="週期單位" className="w-24 flex-none" {...form.register('cycleUnit')}>
            <option value="MONTH">個月</option>
            <option value="DAY">天</option>
          </Select>
        </div>
      </Field>

      <Field
        label="起算日"
        htmlFor={fid('baseline')}
        error={form.formState.errors.baselineOn?.message}
        hint="還沒有更換紀錄時，用這個日期推算第一次的到期日（「裝機時就換過」）"
      >
        <Input id={fid('baseline')} type="date" {...form.register('baselineOn')} />
      </Field>

      <CheckboxRow label="發送到期提醒" {...form.register('notifyEnabled')} />
      <CheckboxRow
        label="啟用中"
        hint="停用後不出現在挑選器與泳道，但歷史紀錄完整保留"
        {...form.register('active')}
      />

      <FormError message={run.result?.serverError} />
      <FormActions
        pending={run.isPending}
        submitLabel={editing ? '儲存' : '新增種類'}
        onCancel={onCancel}
      />
    </form>
  )
}
