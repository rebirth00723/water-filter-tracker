'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useAction } from 'next-safe-action/hooks'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import { addItem, editItem } from '@/app/(app)/settings/devices/actions'
import { CheckboxRow, Field, Input } from '@/components/ui'
import { createItemFields } from '@/lib/schemas/settings'
import type { Item } from '@/lib/settings-store'
import { actionErrorMessage } from './action-feedback'
import { FormActions, FormError } from './FormShell'

/*
 * 表單一律用「新增」那份 schema（多一個 initialStock）。
 * 編輯時那個欄位不渲染，送出前也會被拆掉 ——
 * 用兩份 schema 換得的只是型別上的整齊，代價是兩套 resolver 與兩個型別參數。
 */
type In = z.input<typeof createItemFields>

/**
 * 耗材表單。
 *
 * `onCreated` 讓「就地新增」成立：更換表單的挑選器在種類底下沒有耗材時
 * 會用到這個元件，新增完要能立刻選用剛建好的那一項。
 * 系統預設不帶任何耗材品項，所以**每個使用者的第一次更換都會走到這條路**。
 */
export function ItemForm({
  categoryId,
  item,
  onCreated,
  onDone,
  onCancel,
}: {
  categoryId: number
  item?: Item
  onCreated?: (created: { id: number; name: string; categoryId: number; defaultQty: number }) => void
  onDone?: () => void
  onCancel?: () => void
}) {
  const editing = item !== undefined
  // 同一個表單可能同時掛載多份，id 必須每個實例唯一（見 DeviceForm 的說明）
  const uid = useId()
  const fid = (name: string) => `${uid}-${name}`

  const form = useForm<In, unknown, In>({
    resolver: zodResolver(createItemFields, undefined, { raw: true }),
    defaultValues: {
      name: item?.name ?? '',
      brand: item?.brand ?? '',
      defaultQty: String(item?.defaultQty ?? 1),
      initialStock: '0',
      active: item?.active ?? true,
    },
  })

  const create = useAction(addItem, {
    onSuccess: ({ data }) => {
      toast.success(`已新增耗材「${data.name}」`)
      form.reset()
      onCreated?.(data)
      onDone?.()
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })
  const update = useAction(editItem, {
    onSuccess: ({ data }) => {
      toast.success(`已更新「${data.name}」`)
      onDone?.()
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  const run = editing ? update : create

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
      onSubmit={form.handleSubmit(({ initialStock, ...rest }) =>
        // initialStock 只屬於新增：編輯時明確拆掉，而不是丟給 zod 去 strip
        editing
          ? update.execute({ ...rest, id: item.id })
          : create.execute({ ...rest, initialStock, categoryId }),
      )}
    >
      <Field label="耗材名稱" htmlFor={fid('name')} required error={form.formState.errors.name?.message}>
        <Input
          id={fid('name')}
          autoComplete="off"
          placeholder="PP 棉濾心 10 吋"
          {...form.register('name')}
        />
      </Field>

      <Field label="品牌" htmlFor={fid('brand')} error={form.formState.errors.brand?.message}>
        <Input id={fid('brand')} autoComplete="off" {...form.register('brand')} />
      </Field>

      {/*
        * 這兩個欄位放在一起，是因為它們**最容易被搞混**。
        *
        * 「每次數量」只是記一筆的時候預先帶進清單的數字，和手上有幾個無關；
        * 「目前庫存」才是存貨。原本前者叫「預設數量」，於是有人填了 3
        * 以為庫存就變成 3 —— 但庫存純粹由事件推算（新購 +、更換 −），
        * 建立耗材這個動作本身不產生任何事件。
        */}
      <Field
        label="每次數量"
        htmlFor={fid('qty')}
        error={form.formState.errors.defaultQty?.message}
        hint="記更換或新購時，預先帶幾個進清單。當下還是可以改，和庫存無關"
      >
        <Input
          id={fid('qty')}
          type="number"
          inputMode="numeric"
          min={1}
          max={99}
          {...form.register('defaultQty')}
        />
      </Field>

      {!editing && (
        <Field
          label="目前庫存"
          htmlFor={fid('stock')}
          error={form.formState.errors.initialStock?.message}
          hint="手上現在有幾個。會記成一筆盤點，之後靠新購與更換自動增減。沒有就留 0"
        >
          <Input
            id={fid('stock')}
            type="number"
            inputMode="numeric"
            min={0}
            max={999}
            {...form.register('initialStock')}
          />
        </Field>
      )}

      <CheckboxRow
        label="啟用中"
        hint="停用後不出現在挑選器，但歷史紀錄完整保留"
        {...form.register('active')}
      />

      <FormError message={run.result?.serverError} />
      <FormActions
        pending={run.isPending}
        submitLabel={editing ? '儲存' : '新增耗材'}
        onCancel={onCancel}
      />
    </form>
  )
}
