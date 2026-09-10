'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, X } from 'lucide-react'
import { useAction } from 'next-safe-action/hooks'
import { useId, useState } from 'react'
import { useFieldArray, useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { addEvent, editEvent } from '@/app/(app)/d/[deviceId]/consumables/actions'
import { actionErrorMessage } from '@/components/forms/action-feedback'
import { FormActions, FormError } from '@/components/forms/FormShell'
import { Badge, Button, ColorDot, Field, Input, Textarea } from '@/components/ui'
import { fmtZh } from '@/lib/date'
import type { EventRow } from '@/lib/events-store'
import {
  MAX_UNIT_PRICE,
  purchaseFormSchema,
  replaceFormSchema,
} from '@/lib/schemas/events'
import { MAX_PPM } from '@/lib/schemas/readings'
import { cn } from '@/lib/utils'
import { ItemPicker } from './ItemPicker'
import type { PickerCategory } from '@/lib/picker-data'
import { QtyStepper } from './QtyStepper'

/** 表單是扁平的：使用者用一個切換鈕在新購／更換之間切，欄位大部分共用 */
interface Fields {
  type: 'PURCHASE' | 'REPLACE'
  occurredOn: string
  vendor: string
  note: string
  rawPpm: string
  purePpm: string
  lines: { itemId: number; categoryId: number; qty: number; unitPrice: string }[]
}

/**
 * 依當下的 type 選一個分支驗證。兩個分支共用同一組 shape 與同一份 crossChecks，
 * 也和伺服端的 createEvent/updateEvent 同源，所以規則不會漂移。
 *
 * 兩個 resolver 各自建好再選，而不是把三元運算的結果餵給 zodResolver ——
 * 後者會讓 schema 的型別變成兩個 ZodObject 的聯集，而 zodResolver 只能吃單一 schema。
 *
 * 需要一次轉型，原因是**表單是扁平的而 schema 是分支的**：
 * `Fields` 同時有 vendor 與 rawPpm/purePpm，而每個分支只認其中一組，
 * 所以 zodResolver 宣告的輸入型別比表單的欄位集合窄。
 * 執行期是安全的 —— zod 預設剝掉未知的鍵，而 `raw: true` 讓 handleSubmit
 * 拿回原本那個完整的物件（送出時要用 vendor 或 PPM 都還在）。
 */
const purchaseResolver = zodResolver(purchaseFormSchema, undefined, {
  raw: true,
}) as unknown as Resolver<Fields>
const replaceResolver = zodResolver(replaceFormSchema, undefined, {
  raw: true,
}) as unknown as Resolver<Fields>

const resolver: Resolver<Fields> = (values, ctx, opts) =>
  (values.type === 'PURCHASE' ? purchaseResolver : replaceResolver)(values, ctx, opts)

export interface EventFormTemplate {
  key: string
  label: string
  lastUsedOn: string
  lines: { itemId: number; categoryId: number; qty: number }[]
}

export function EventForm({
  deviceId,
  event,
  categories,
  templates,
  today,
  onDone,
  onCancel,
}: {
  deviceId: number
  event?: EventRow
  categories: PickerCategory[]
  templates: EventFormTemplate[]
  today: string
  onDone?: () => void
  onCancel?: () => void
}) {
  const editing = event !== undefined
  const uid = useId()
  const fid = (n: string) => `${uid}-${n}`
  const [picking, setPicking] = useState(false)

  const form = useForm<Fields>({
    resolver,
    defaultValues: {
      type: event?.type === 'PURCHASE' ? 'PURCHASE' : 'REPLACE',
      occurredOn: event?.occurredOn ?? today,
      vendor: event?.vendor ?? '',
      note: event?.note ?? '',
      rawPpm: event?.reading ? String(event.reading.rawPpm) : '',
      purePpm: event?.reading ? String(event.reading.purePpm) : '',
      lines:
        event?.lines.map((l) => ({
          itemId: l.itemId,
          categoryId: l.categoryId,
          qty: l.qty,
          unitPrice: l.unitPrice != null ? String(l.unitPrice) : '',
        })) ?? [],
    },
  })

  const { fields, append, remove, update } = useFieldArray({ control: form.control, name: 'lines' })
  const type = form.watch('type')
  const isReplace = type === 'REPLACE'

  const onError = ({ error }: { error: Parameters<typeof actionErrorMessage>[0] }) =>
    toast.error(actionErrorMessage(error))

  const create = useAction(addEvent, {
    onSuccess: ({ data }) => {
      toast.success(
        `已記錄 ${fmtZh(data.occurredOn)} 的${data.type === 'REPLACE' ? '更換' : '新購'}（${data.lineCount} 項）`,
      )
      onDone?.()
    },
    onError,
  })
  const update_ = useAction(editEvent, {
    onSuccess: ({ data }) => {
      toast.success(`已更新 ${fmtZh(data.occurredOn)} 的紀錄`)
      onDone?.()
    },
    onError,
  })
  const run = editing ? update_ : create

  /** 名稱查表，讓已選清單能顯示種類色點與耗材名稱 */
  const lookup = (itemId: number) => {
    for (const c of categories) {
      const it = c.items.find((i) => i.id === itemId)
      if (it) return { category: c, item: it }
    }
    return null
  }

  function addLine(picked: { itemId: number; categoryId: number; qty: number; name: string }) {
    const at = fields.findIndex((f) => f.itemId === picked.itemId)
    if (at >= 0) {
      // 重複挑選同一項就合併數量並提示，而不是報錯 ——
      // 使用者的意圖很明確，報錯只是把責任推回去
      const next = Math.min(99, fields[at].qty + picked.qty)
      update(at, { ...fields[at], qty: next })
      toast.info(`「${picked.name}」已在清單裡，數量合併為 ${next}`)
      return
    }
    append({ itemId: picked.itemId, categoryId: picked.categoryId, qty: picked.qty, unitPrice: '' })
  }

  function applyTemplate(t: EventFormTemplate) {
    form.setValue(
      'lines',
      t.lines.map((l) => ({ ...l, unitPrice: '' })),
      { shouldValidate: false },
    )
    toast.success(`已套用「${t.label}」`)
  }

  const lineErrors = form.formState.errors.lines
  const rootLineError = Array.isArray(lineErrors) ? undefined : lineErrors?.message

  return (
    <form
      noValidate
      className="space-y-4 pt-2"
      onSubmit={form.handleSubmit((values) => {
        const lines = values.lines.map((l) => ({
          itemId: l.itemId,
          categoryId: l.categoryId,
          qty: l.qty,
          unitPrice: l.unitPrice,
        }))
        const common = { occurredOn: values.occurredOn, note: values.note, lines }
        const payload =
          values.type === 'PURCHASE'
            ? ({ type: 'PURCHASE', ...common, vendor: values.vendor } as const)
            : ({
                type: 'REPLACE',
                ...common,
                rawPpm: values.rawPpm,
                purePpm: values.purePpm,
              } as const)
        return editing
          ? update_.execute({ ...payload, id: event.id })
          : create.execute({ ...payload, deviceId })
      })}
    >
      {/* 型別切換。用 radio 而不是下拉：兩個選項而已，且要一眼看出現在是哪個 */}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">這筆是</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { v: 'REPLACE', label: '更換', hint: '裝上去了' },
              { v: 'PURCHASE', label: '新購', hint: '買回來放著' },
            ] as const
          ).map((o) => (
            <label
              key={o.v}
              className={cn(
                'flex min-h-14 cursor-pointer flex-col justify-center rounded-md border px-3 py-2',
                type === o.v ? 'border-primary bg-accent' : 'border-input',
              )}
            >
              <span className="flex items-center gap-2">
                <input type="radio" value={o.v} className="sr-only" {...form.register('type')} />
                <span className="text-sm font-medium">{o.label}</span>
              </span>
              <span className="mt-0.5 text-xs text-muted-foreground">{o.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        label={isReplace ? '更換日期' : '購買日期'}
        htmlFor={fid('date')}
        required
        error={form.formState.errors.occurredOn?.message}
      >
        <Input id={fid('date')} type="date" {...form.register('occurredOn')} />
      </Field>

      {/*
        PPM 排在耗材項目之前，這個順序是刻意的：使用者站在水槽邊拿著 TDS 筆，
        PPM 是會消失的輸入（水倒掉、筆歸零就沒了），必須先打完；
        換了哪幾支濾心事後回想得起來。
      */}
      {/*
        從「更換」切成「新購」會刪掉這筆事件擁有的水質紀錄（PPM 只存在
        readings 一張表，由事件擁有）。而切過去之後 PPM 欄位整個消失，
        使用者根本看不到自己正要丟掉什麼 —— 所以要在切換前就講。
      */}
      {editing && event.reading && !isReplace && (
        <p
          role="alert"
          className="rounded-md bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning"
        >
          這筆原本記了當天的水質（原水 {event.reading.rawPpm} / 純水{' '}
          {event.reading.purePpm} ppm）。改成「新購」並儲存之後<strong>那筆水質紀錄會被刪除</strong>
          ，報表上的那個點也會消失。想保留的話請切回「更換」。
        </p>
      )}

      {isReplace ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">當天水質（可略）</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="原水 PPM" htmlFor={fid('raw')} error={form.formState.errors.rawPpm?.message}>
              <Input
                id={fid('raw')}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_PPM}
                className="tabular"
                {...form.register('rawPpm')}
              />
            </Field>
            <Field
              label="純水 PPM"
              htmlFor={fid('pure')}
              error={form.formState.errors.purePpm?.message}
            >
              <Input
                id={fid('pure')}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_PPM}
                className="tabular"
                {...form.register('purePpm')}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            填了會同時出現在水質紀錄與報表；沒帶 TDS 筆就留空，之後補不了這一天的數字。
          </p>
        </fieldset>
      ) : (
        <Field
          label="購買來源"
          htmlFor={fid('vendor')}
          error={form.formState.errors.vendor?.message}
          hint="店家名稱或商品連結。下次挑選這項耗材時會顯示「上次在這裡買」"
        >
          <Input id={fid('vendor')} autoComplete="off" {...form.register('vendor')} />
        </Field>
      )}

      {/* 範本 chip：一鍵填滿整個清單，這才是 30 秒的真正來源 */}
      {isReplace && templates.length > 0 && fields.length === 0 && (
        <div>
          <p className="mb-1.5 text-sm font-medium">套用上次的組合</p>
          <div className="flex flex-wrap gap-2">
            {templates.map((t, i) => (
              <button
                key={t.key}
                type="button"
                onClick={() => applyTemplate(t)}
                className="rounded-full border border-input bg-card px-3 py-2 text-xs hover:bg-muted"
              >
                {i === 0 ? '同上次 · ' : ''}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 耗材項目 */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          耗材項目 <span className="text-destructive">*</span>
        </legend>

        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">還沒有項目。挑選器裡會顯示每個種類的逾期天數。</p>
        ) : (
          <ul className="space-y-2">
            {fields.map((f, i) => {
              const found = lookup(f.itemId)
              return (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
                >
                  {found && <ColorDot color={found.category.color} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {found?.item.name ?? `耗材 #${f.itemId}`}
                    </span>
                    {found && (
                      <span className="text-xs text-muted-foreground">{found.category.name}</span>
                    )}
                  </span>

                  <QtyStepper
                    label={found?.item.name ?? '項目'}
                    value={form.watch(`lines.${i}.qty`)}
                    onChange={(v) => form.setValue(`lines.${i}.qty`, v, { shouldValidate: true })}
                  />

                  {!isReplace && (
                    <Input
                      aria-label={`${found?.item.name ?? '項目'} 單價`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_UNIT_PRICE}
                      placeholder="單價"
                      className="tabular h-11 w-24"
                      {...form.register(`lines.${i}.unitPrice`)}
                    />
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`移除 ${found?.item.name ?? '項目'}`}
                    onClick={() => remove(i)}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        {rootLineError && (
          <p role="alert" className="text-xs text-destructive">
            {rootLineError}
          </p>
        )}

        <Button type="button" variant="secondary" onClick={() => setPicking(true)}>
          <Plus className="size-4" aria-hidden />
          加入耗材
        </Button>
      </fieldset>

      {!isReplace && fields.length > 0 && (
        <p className="text-xs text-muted-foreground">
          合計{' '}
          <strong className="tabular text-foreground">
            $
            {fields.reduce(
              (s, _, i) =>
                s + (Number(form.watch(`lines.${i}.unitPrice`)) || 0) * form.watch(`lines.${i}.qty`),
              0,
            )}
          </strong>
          （沒填單價的算 0）
        </p>
      )}

      <Field label="備註" htmlFor={fid('note')} error={form.formState.errors.note?.message}>
        <Textarea id={fid('note')} rows={2} {...form.register('note')} />
      </Field>

      <FormError message={run.result?.serverError} />
      <FormActions
        pending={run.isPending}
        submitLabel={editing ? '儲存' : '記錄'}
        pendingLabel={editing ? '儲存中…' : '記錄中…'}
        onCancel={onCancel}
      />

      <ItemPicker
        categories={categories}
        open={picking}
        onOpenChange={setPicking}
        onPick={addLine}
      />
    </form>
  )
}
