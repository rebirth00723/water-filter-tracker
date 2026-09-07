import { createSafeActionClient } from 'next-safe-action'
import { z } from 'zod'
import { audit, type AuditEntry } from './audit'
import { clientIp, userAgent } from './auth/client-ip'
import { requireUser } from './auth/require'
import { log } from './log'

/**
 * 所有寫入操作的共用外層。
 *
 * **Server Action 是公開的 HTTP 端點** —— 渲染表單的頁面做過授權不算，
 * 每一個 action 都必須自己驗一次。這個 client 讓「驗一次」變成無法遺漏的預設值：
 * 忘記用它的 action 連編譯都不會過（因為拿不到 ctx 裡的 user）。
 *
 * 職責切分刻意如此：
 * - **中介層**負責機械性的部分 —— 授權、身分（誰／從哪／用什麼裝置）、錯誤攔截。
 *   這些每個 action 都一樣，集中處理才不會漏。
 * - **各 action** 負責語意性的部分 —— 中文摘要與 entity。只有 action 自己知道
 *   「新增設備『廚下 RO』」該怎麼寫，硬要中介層產生只會得到一堆看不懂的通用字串。
 *
 * 兩者的接點是 ctx.audit()：身分欄位已經填好，呼叫端只需要補語意。
 */

/** action 的識別名稱，會成為 audit_log.action 的值（例如 device.create） */
const metadataSchema = z.object({ name: z.string().min(1) })

export class ActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionError'
  }
}

export const actionClient = createSafeActionClient({
  defineMetadataSchema: () => metadataSchema,
  defaultValidationErrorsShape: 'flattened',

  /**
   * 錯誤訊息只在刻意丟出 ActionError 時原樣回傳給使用者；
   * 其餘（含資料庫層的例外）一律換成通用訊息 ——
   * SQLite 的錯誤字串會夾帶表格與欄位名稱，那不該出現在瀏覽器裡。
   */
  handleServerError(error, { metadata }) {
    if (error instanceof ActionError) return error.message

    log.error('Server Action 失敗', { err: error, action: metadata?.name })
    return '操作失敗，請稍後再試。若持續發生請查看容器日誌。'
  },
})

/** 已授權的 action client。ctx 帶著使用者身分與一個綁好身分的 audit() */
export const authedAction = actionClient.use(async ({ next, metadata }) => {
  const user = await requireUser()
  const [ip, ua] = await Promise.all([clientIp(), userAgent()])

  return next({
    ctx: {
      user,
      ip,
      userAgent: ua,
      /** 身分欄位已填好，呼叫端只需補語意。action 名稱預設取 metadata.name */
      audit(entry: Omit<AuditEntry, 'username' | 'ip' | 'userAgent' | 'action'> & { action?: string }) {
        audit({
          ...entry,
          action: entry.action ?? metadata.name,
          username: user.username,
          ip,
          userAgent: ua,
        })
      },
    },
  })
})
