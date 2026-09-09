import 'server-only'
import { Cron } from 'croner'
import { APP_TIME_ZONE } from '../date'
import { log } from '../log'
import { pruneAuditLog, sweep } from './sweep'

/**
 * 排程。**每 15 分鐘掃描 + 開機後 20 秒補掃一次**，
 * 而不是「每天在設定的時刻觸發一次」——
 * 後者在機器剛好那個時刻沒開機時就整天不送。詳見 sweep.ts 的說明。
 *
 * 不開 sidecar 容器：sidecar 與 app 同機，一起關機、一起錯過，
 * 宣稱的「解耦」優勢是假的，換來的是多一個要維護的容器。
 */

const KEY = Symbol.for('ro-tracker.cron')
const g = globalThis as unknown as Record<symbol, Cron[] | undefined>

export function startSchedule(): void {
  // 開發模式的 HMR 會讓模組重新求值，globalThis 是唯一擋得住的地方
  if (g[KEY]) return

  const jobs: Cron[] = []

  jobs.push(
    new Cron(
      '*/15 * * * *',
      // protect：上一輪還沒結束就不疊加。ntfy 逾時 8 秒 × 多個項目可能超過 15 分鐘
      { name: 'notify-sweep', protect: true, timezone: APP_TIME_ZONE },
      async () => {
        try {
          const res = await sweep()
          if (res.sent > 0 || res.failed > 0) {
            log.info('通知掃描完成', { ...res, notes: undefined })
          }
        } catch (err) {
          log.error('通知掃描失敗', { err })
        }
      },
    ),
  )

  jobs.push(
    new Cron(
      '17 3 * * *',
      { name: 'prune-audit', protect: true, timezone: APP_TIME_ZONE },
      () => {
        try {
          const n = pruneAuditLog()
          if (n > 0) log.info('清理稽核紀錄', { deleted: n })
        } catch (err) {
          log.error('清理稽核紀錄失敗', { err })
        }
      },
    ),
  )

  /*
   * 開機後補掃一次。
   *
   * 20 秒的理由：讓 migration、seed 與第一批請求先過去 ——
   * 開機瞬間就發起 ntfy 的網路請求，在容器編排還在拉起其他服務時容易失敗，
   * 然後那筆就進了失敗佇列。
   */
  setTimeout(() => {
    void sweep()
      .then((res) => {
        if (res.sent > 0) log.info('開機補掃完成', { sent: res.sent })
      })
      .catch((err) => log.error('開機補掃失敗', { err }))
  }, 20_000).unref?.()

  g[KEY] = jobs
  log.info('排程已啟動', { jobs: jobs.map((j) => j.name) })
}
