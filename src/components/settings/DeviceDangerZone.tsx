'use client'

import { useRouter } from 'next/navigation'
import { useAction } from 'next-safe-action/hooks'
import { toast } from 'sonner'
import { removeDevice } from '@/app/(app)/settings/devices/actions'
import { actionErrorMessage } from '@/components/forms/action-feedback'
import { ConfirmButton } from '@/components/forms/ConfirmButton'

/**
 * 刪除設備。
 *
 * 分開成一個元件是因為它的後果與其他刪除不同一個量級 ——
 * 會 cascade 掉那台機器的種類、耗材、事件、明細與水質紀錄。
 * 有任何歷史時伺服端會直接拒絕，所以這裡先把數字攤開講清楚，
 * 讓使用者在按之前就知道該用「停用」而不是「刪除」。
 */
export function DeviceDangerZone({
  deviceId,
  deviceName,
  history,
}: {
  deviceId: number
  deviceName: string
  history: { events: number; readings: number }
}) {
  const router = useRouter()
  const hasHistory = history.events > 0 || history.readings > 0

  const del = useAction(removeDevice, {
    onSuccess: ({ data }) => {
      toast.success(`已刪除設備「${data.name}」`)
      router.push('/settings/devices')
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  return (
    <section className="rounded-lg border border-destructive/30 px-4 py-3.5">
      <h2 className="text-sm font-semibold text-destructive">刪除設備</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {hasHistory ? (
          <>
            這台設備已經有 <strong className="tabular">{history.events}</strong> 筆耗材紀錄與{' '}
            <strong className="tabular">{history.readings}</strong> 筆水質紀錄。
            刪除會一併清空這些歷史，因此系統不允許 —— 請改用上面的「啟用中」開關停用它。
            停用後它不再出現在切換器、首頁與提醒裡，但資料完整保留，舊連結也還能打開查歷史。
          </>
        ) : (
          <>這台設備還沒有任何耗材或水質紀錄，可以安全刪除。種類與耗材設定會一併移除。</>
        )}
      </p>
      <div className="mt-3">
        <ConfirmButton
          label="刪除這台設備"
          title={`刪除設備「${deviceName}」？`}
          description={
            hasHistory ? (
              <>
                有歷史紀錄的設備不能刪除。按下確定只會得到一則錯誤訊息 ——
                請關閉這個視窗，改用「啟用中」開關停用它。
              </>
            ) : (
              <>會一併移除這台設備的所有種類與耗材設定。這個操作無法復原。</>
            )
          }
          confirmLabel="確定刪除"
          pending={del.isPending}
          onConfirm={() => del.execute({ id: deviceId })}
        />
      </div>
    </section>
  )
}
