'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { clientIp, userAgent } from '@/lib/auth/client-ip'
import { validatePassword } from '@/lib/auth/password'
import { requireAdmin } from '@/lib/auth/require'
import { regenerateSessionKey } from '@/lib/auth/session'
import { bumpTokenVersion, setPassword } from '@/lib/auth/store'
import { CONFIG_KEYS, getPublicUrl, isEnvControlled, setConfig } from '@/lib/config'
import { manualSweep } from '@/lib/notify/sweep'
import { NtfyError, sendNtfy } from '@/lib/notify/ntfy'
import { ActionError, actionClient } from '@/lib/safe-action'
import { ntfyConfigSchema, testNotifySchema } from '@/lib/schemas/notify'
import { optionalText } from '@/lib/schemas/common'

/**
 * 管理中心的 action。
 *
 * **用 actionClient 而不是 authedAction**，並在每個 action 裡各自呼叫
 * `requireAdmin()` —— 因為 admin 的授權規則與其他頁面不同：
 * 無密碼模式下不要求 session（那是補設密碼的唯一入口）。
 * 沿用 authedAction 會讓那條補救路走不通。
 */
const adminAction = actionClient.use(async ({ next }) => {
  const user = await requireAdmin()
  const [ip, ua] = await Promise.all([clientIp(), userAgent()])
  return next({
    ctx: {
      user,
      /** 身分欄位已填好，呼叫端只需補語意。與 authedAction 的 ctx.audit 同一個用法 */
      note(entry: { action: string; summary: string; after?: unknown }) {
        audit({ ...entry, username: user.username, ip, userAgent: ua })
      },
    },
  })
})

// ─────────────────────────── 對外網址 ───────────────────────────

export const savePublicUrl = adminAction
  .metadata({ name: 'admin.publicUrl' })
  .inputSchema(z.object({ publicUrl: optionalText(200) }))
  .action(async ({ parsedInput: { publicUrl }, ctx }) => {
    if (isEnvControlled(CONFIG_KEYS.publicUrl)) {
      throw new ActionError('對外網址由環境變數 PUBLIC_URL 控制，無法從介面修改')
    }
    if (publicUrl) {
      let parsed: URL
      try {
        parsed = new URL(publicUrl)
      } catch {
        throw new ActionError('網址格式不正確，需要含協定，例如 https://water.example.com')
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new ActionError('只接受 http 或 https')
      }
    }

    const before = getPublicUrl()
    setConfig(CONFIG_KEYS.publicUrl, publicUrl)

    /*
     * 改網址會讓所有既有的 passkey 失效（RP ID 綁網域），
     * 所以要在稽核紀錄裡講清楚 —— 之後排查「怎麼突然不能用 passkey 了」時，
     * 這一行是唯一的線索。
     */
    ctx.note({
      action: 'admin.publicUrl',
      summary: `對外網址由「${before ?? '(未設定)'}」改為「${publicUrl ?? '(未設定)'}」。既有的 passkey 會全部失效`,
    })
    refresh()
    return { publicUrl }
  })

// ─────────────────────────── ntfy ───────────────────────────

export const saveNtfyConfig = adminAction
  .metadata({ name: 'admin.ntfy' })
  .inputSchema(ntfyConfigSchema)
  .action(async ({ parsedInput: v, ctx }) => {
    const envLocked: string[] = []
    const put = (key: (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS], value: string | null) => {
      if (isEnvControlled(key)) {
        envLocked.push(key)
        return
      }
      setConfig(key, value)
    }

    put(CONFIG_KEYS.ntfyUrl, v.url)
    put(CONFIG_KEYS.ntfyTopicFilter, v.topicFilter)
    put(CONFIG_KEYS.ntfyTopicSecurity, v.topicSecurity)

    if (v.clearAuth) {
      put(CONFIG_KEYS.ntfyToken, null)
      put(CONFIG_KEYS.ntfyUser, null)
      put(CONFIG_KEYS.ntfyPassword, null)
    } else {
      // 留空＝不變更。管理中心刻意不回顯已存的認證值，
      // 所以空字串必須解讀成「沒有要改」而不是「清空」
      if (v.token) {
        put(CONFIG_KEYS.ntfyToken, v.token)
        // token 優先於帳密，兩者同時存在只會讓「到底用哪個」變成謎
        put(CONFIG_KEYS.ntfyUser, null)
        put(CONFIG_KEYS.ntfyPassword, null)
      } else if (v.user && v.password) {
        put(CONFIG_KEYS.ntfyUser, v.user)
        put(CONFIG_KEYS.ntfyPassword, v.password)
        put(CONFIG_KEYS.ntfyToken, null)
      }
    }

    ctx.note({
      action: 'admin.ntfy',
      // 絕不把認證值寫進稽核紀錄
      summary:
        `修改 ntfy 設定：伺服器「${v.url ?? '(未設定)'}」、` +
        `濾心 topic「${v.topicFilter ?? '(未設定)'}」、安全 topic「${v.topicSecurity ?? '(未設定)'}」` +
        (v.clearAuth ? '，已清除認證' : v.token ? '，已更新 token' : v.user ? '，已更新帳密' : ''),
    })
    refresh()
    return {
      envLocked,
      message:
        envLocked.length > 0
          ? `已儲存，但 ${envLocked.join('、')} 由環境變數控制，介面上的值不會生效`
          : '已儲存',
    }
  })

export const sendTestNotification = adminAction
  .metadata({ name: 'admin.ntfyTest' })
  .inputSchema(testNotifySchema)
  .action(async ({ parsedInput: { channel }, ctx }) => {
    try {
      const res = await sendNtfy({
        channel,
        title: channel === 'security' ? '安全通知測試' : '濾心提醒測試',
        message:
          channel === 'security'
            ? '這是一則測試訊息。之後新增或刪除 passkey 時會走這條 topic。'
            : '這是一則測試訊息。之後濾心到期提醒會走這條 topic。',
        priority: 3,
        tags: ['white_check_mark'],
        click: getPublicUrl(),
      })
      ctx.note({
        action: 'admin.ntfyTest',
        summary: `測試通知送出成功（topic：${res.topic}）`,
      })
      return { topic: res.topic, message: `已送出到 topic「${res.topic}」，請看手機` }
    } catch (err) {
      // 錯誤分類已經在 sendNtfy 裡做好，訊息可直接顯示給使用者
      const msg = err instanceof NtfyError ? err.message : (err as Error).message
      ctx.note({ action: 'admin.ntfyTest.fail', summary: `測試通知失敗：${msg}` })
      throw new ActionError(msg)
    }
  })

export const triggerSweep = adminAction
  .metadata({ name: 'admin.sweep' })
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    /*
     * 手動觸發跳過「發送時刻還沒到」這個條件，**但不跳過去重** ——
     * 按三次不該送出三則一樣的通知。這也是驗證冪等性的方式：
     * 第二三次的送出數應該是 0。
     */
    const res = await manualSweep(ctx.user.username)
    return res
  })

// ─────────────────────────── 密碼與 session ───────────────────────────

export const adminSetPassword = adminAction
  .metadata({ name: 'admin.setPassword' })
  .inputSchema(
    z
      .object({
        password: z.string(),
        confirm: z.string(),
      })
      .superRefine((v, ctx) => {
        const problem = validatePassword(v.password)
        if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem })
        if (v.password !== v.confirm) {
          ctx.addIssue({ code: 'custom', path: ['confirm'], message: '兩次輸入不一致' })
        }
      }),
  )
  .action(async ({ parsedInput: { password }, ctx }) => {
    const wasOpen = ctx.user.openMode
    // setPassword 內部就會雜湊，這裡傳明文
    await setPassword(ctx.user.username, password)

    /*
     * 從無密碼切換成密碼模式時要遞增 tokenVersion。
     * 無密碼模式下不存在 session，所以嚴格說沒有東西需要失效 ——
     * 但若曾經有過密碼、中間關掉、現在又打開，舊的 session 還簽得過。
     */
    bumpTokenVersion(ctx.user.username)

    ctx.note({
      action: 'admin.setPassword',
      summary: wasOpen
        ? `從無密碼模式切換為密碼模式，並設定了密碼。所有裝置需重新登入`
        : `從管理中心修改密碼。所有裝置需重新登入`,
    })
    refresh()
    return { wasOpen }
  })

export const regenSessionKey = adminAction
  .metadata({ name: 'admin.regenSessionKey' })
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    regenerateSessionKey()
    ctx.note({
      action: 'admin.regenSessionKey',
      summary: '重新產生 session 金鑰，所有已登入的裝置都已登出',
    })
    return { ok: true }
  })
