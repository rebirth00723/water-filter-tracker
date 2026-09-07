'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useAction } from 'next-safe-action/hooks'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import {
  addReading,
  editEventReading,
  editReading,
} from '@/app/(app)/d/[deviceId]/water/actions'
import { Field, Input, Textarea } from '@/components/ui'
import { fmtZh } from '@/lib/date'
import type { Reading } from '@/lib/readings-store'
import { MAX_PPM, readingFormSchema } from '@/lib/schemas/readings'
import { actionErrorMessage } from './action-feedback'
import { FormActions, FormError } from './FormShell'

type In = z.input<typeof readingFormSchema>

/**
 * 欄位順序刻意是**日期 → PPM → 備註**，而 PPM 兩格並排。
 *
 * 使用者站在水槽邊拿著 TDS 筆：PPM 是會消失的輸入（水倒掉、筆歸零就沒了），
 * 必須最先打完；備註事後回想得起來。這個順序在更換表單裡也一樣。
 */
export function ReadingForm({
  deviceId,
  reading,
  today,
  onDone,
  onCancel,
  compact,
}: {
  deviceId: number
  /** 有值＝編輯模式。`reading.eventId !== null` 時日期鎖定 */
  reading?: Reading
  /** 由伺服器算好的今天（Asia/Taipei）。不用瀏覽器的時區推導，出國時才不會差一天 */
  today: string
  onDone?: () => void
  onCancel?: () => void
  compact?: boolean
}) {
  const editing = reading !== undefined
  const dateLocked = reading?.eventId != null
  const uid = useId()
  const fid = (n: string) => `${uid}-${n}`

  const form = useForm<In, unknown, In>({
    resolver: zodResolver(readingFormSchema, undefined, { raw: true }),
    defaultValues: {
      measuredOn: reading?.measuredOn ?? today,
      rawPpm: reading ? String(reading.rawPpm) : '',
      purePpm: reading ? String(reading.purePpm) : '',
      note: reading?.note ?? '',
    },
  })

  const onError = ({ error }: { error: Parameters<typeof actionErrorMessage>[0] }) =>
    toast.error(actionErrorMessage(error))

  const create = useAction(addReading, {
    onSuccess: ({ data }) => {
      toast.success(`已記錄 ${fmtZh(data.measuredOn)} 的水質`)
      // 只清 PPM 與備註，日期留著 —— 連續補登好幾天時省掉重複選日期
      form.reset({ ...form.getValues(), rawPpm: '', purePpm: '', note: '' })
      onDone?.()
    },
    onError,
  })
  const update = useAction(editReading, {
    onSuccess: ({ data }) => {
      toast.success(`已更新 ${fmtZh(data.measuredOn)} 的紀錄`)
      onDone?.()
    },
    onError,
  })
  const updateEvent = useAction(editEventReading, {
    onSuccess: ({ data }) => {
      toast.success(`已更新 ${fmtZh(data.measuredOn)} 的紀錄`)
      onDone?.()
    },
    onError,
  })

  const run = editing ? (dateLocked ? updateEvent : update) : create
  const raw = form.watch('rawPpm')
  const pure = form.watch('purePpm')

  // 去除率即時算給使用者看：這才是判斷濾心衰退的訊號，純水的絕對值會被原水波動帶著跑
  const rate = (() => {
    const r = Number(raw)
    const p = Number(pure)
    if (!raw || !pure || !Number.isFinite(r) || !Number.isFinite(p) || r <= 0) return null
    if (p > r) return null
    return ((r - p) / r) * 100
  })()

  return (
    <form
      noValidate
      className={compact ? 'space-y-3' : 'space-y-4 pt-2'}
      onSubmit={form.handleSubmit((values) => {
        if (!editing) return create.execute({ ...values, deviceId })
        if (dateLocked) {
          const { rawPpm, purePpm, note } = values
          return updateEvent.execute({ id: reading.id, rawPpm, purePpm, note })
        }
        return update.execute({ ...values, id: reading.id })
      })}
    >
      <Field
        label="量測日期"
        htmlFor={fid('date')}
        required
        error={form.formState.errors.measuredOn?.message}
        hint={
          dateLocked
            ? '日期由那筆更換紀錄擁有，要改請到耗材紀錄改該筆更換的日期'
            : undefined
        }
      >
        <Input id={fid('date')} type="date" disabled={dateLocked} {...form.register('measuredOn')} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="原水 PPM"
          htmlFor={fid('raw')}
          required
          error={form.formState.errors.rawPpm?.message}
        >
          <Input
            id={fid('raw')}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_PPM}
            autoComplete="off"
            className="tabular"
            {...form.register('rawPpm')}
          />
        </Field>
        <Field
          label="純水 PPM"
          htmlFor={fid('pure')}
          required
          error={form.formState.errors.purePpm?.message}
        >
          <Input
            id={fid('pure')}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_PPM}
            autoComplete="off"
            className="tabular"
            {...form.register('purePpm')}
          />
        </Field>
      </div>

      {rate !== null && (
        <p className="text-xs text-muted-foreground">
          去除率 <strong className="tabular text-foreground">{rate.toFixed(1)}%</strong>
          　—— 這比純水的絕對值可靠，原水會隨季節與水源變動
        </p>
      )}

      <Field label="備註" htmlFor={fid('note')} error={form.formState.errors.note?.message}>
        <Textarea
          id={fid('note')}
          rows={2}
          placeholder="例如：換完第一道後量的"
          {...form.register('note')}
        />
      </Field>

      <FormError message={run.result?.serverError} />
      <FormActions
        pending={run.isPending}
        submitLabel={editing ? '儲存' : '記錄'}
        pendingLabel={editing ? '儲存中…' : '記錄中…'}
        onCancel={onCancel}
      />
    </form>
  )
}
