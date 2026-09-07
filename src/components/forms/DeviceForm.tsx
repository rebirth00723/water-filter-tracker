'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useAction } from 'next-safe-action/hooks'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import { addDevice, editDevice } from '@/app/(app)/settings/devices/actions'
import { CheckboxRow, Field, Input } from '@/components/ui'
import type { Device } from '@/lib/devices'
import { deviceFields } from '@/lib/schemas/settings'
import { actionErrorMessage } from './action-feedback'
import { FormActions, FormError } from './FormShell'

type In = z.input<typeof deviceFields>

/**
 * 設備表單。新增與編輯共用一份 —— 欄位完全相同，
 * 分成兩個元件只會讓「新增時忘記加上某個欄位」變成可能。
 */
export function DeviceForm({
  device,
  onDone,
  onCancel,
}: {
  device?: Device
  onDone?: () => void
  onCancel?: () => void
}) {
  const editing = device !== undefined
  /*
   * 欄位 id 必須每個實例唯一，不能寫死。
   * 這個表單可以同時掛載多份（抽屜關閉的退場動畫期間舊的還在 DOM 裡），
   * 寫死 id 會產生重複的 id，而重複 id 會讓 <label for> 指到錯的輸入框 ——
   * 點標籤跳到別的欄位，且螢幕閱讀器念錯。
   */
  const uid = useId()
  const fid = (name: string) => `${uid}-${name}`

  /*
   * `raw: true` 讓 handleSubmit 拿到**未轉換的原始表單值**。
   *
   * 這不是為了方便，而是為了正確：action 的輸入型別是 zod 的 input 型別
   * （空字串、字串數字），伺服端會自己再驗一次並轉換。若這裡先轉成 output
   * 型別（null、number）再送出，送過去的東西就不符合 action 的輸入 schema。
   *
   * 客戶端的 zod 在這個設定下仍然照跑，所以即時驗證與錯誤訊息完全不受影響。
   */
  const form = useForm<In, unknown, In>({
    resolver: zodResolver(deviceFields, undefined, { raw: true }),
    defaultValues: {
      // null 不能直接放進 input 的 value，一律轉成空字串
      name: device?.name ?? '',
      model: device?.model ?? '',
      installedOn: device?.installedOn ?? '',
      ntfyTopic: device?.ntfyTopic ?? '',
      active: device?.active ?? true,
    },
  })

  const create = useAction(addDevice, {
    onSuccess: ({ data }) => {
      toast.success(`已新增設備「${data.name}」`)
      form.reset()
      onDone?.()
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })
  const update = useAction(editDevice, {
    onSuccess: ({ data }) => {
      toast.success(`已更新「${data.name}」`)
      onDone?.()
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  const run = editing ? update : create
  const serverError = run.result?.serverError

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
        editing ? update.execute({ ...values, id: device.id }) : create.execute(values),
      )}
    >
      <Field label="設備名稱" htmlFor={fid('name')} required error={form.formState.errors.name?.message}>
        <Input
          id={fid('name')}
          autoComplete="off"
          placeholder="廚下型 RO"
          {...form.register('name')}
        />
      </Field>

      <Field label="型號" htmlFor={fid('model')} error={form.formState.errors.model?.message}>
        <Input id={fid('model')} autoComplete="off" {...form.register('model')} />
      </Field>

      <Field
        label="裝機日"
        htmlFor={fid('installed')}
        error={form.formState.errors.installedOn?.message}
        hint="所有濾心都沒有更換紀錄與起算日時，用這個日期推算第一次的到期日"
      >
        <Input id={fid('installed')} type="date" {...form.register('installedOn')} />
      </Field>

      <Field
        label="專屬 ntfy topic"
        htmlFor={fid('topic')}
        error={form.formState.errors.ntfyTopic?.message}
        hint="留空＝沿用管理中心設定的濾心提醒 topic。只影響濾心提醒，安全通知不綁設備"
      >
        <Input id={fid('topic')} autoComplete="off" {...form.register('ntfyTopic')} />
      </Field>

      <CheckboxRow
        label="啟用中"
        hint="停用後不再出現在設備切換器與首頁，但歷史紀錄完整保留"
        {...form.register('active')}
      />

      <FormError message={serverError} />
      <FormActions
        pending={run.isPending}
        submitLabel={editing ? '儲存' : '新增設備'}
        onCancel={onCancel}
      />
    </form>
  )
}
