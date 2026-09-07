'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { deleteCredential, renameCredential } from '@/lib/auth/passkey'
import { sendNtfyQuiet } from '@/lib/notify/ntfy'
import { ActionError, authedAction } from '@/lib/safe-action'

/**
 * 自助管理自己的 passkey。
 *
 * 與 admin 的職責刻意不重疊：
 * - 這裡是**日常操作** —— 換裝置、加新瀏覽器、刪掉自己不用的那把
 * - admin 放**全域開關與緊急撤銷** —— 留給手機遺失那類情況
 *
 * 註冊本身走 route handler（WebAuthn 需要兩次往返：拿挑戰、送簽章），
 * 不是 Server Action。
 */

export const removeMyCredential = authedAction
  .metadata({ name: 'passkey.delete' })
  .inputSchema(z.object({ id: z.coerce.number().int().positive() }))
  .action(async ({ parsedInput: { id }, ctx }) => {
    const removed = deleteCredential(ctx.user.username, id)
    if (!removed) throw new ActionError('找不到這筆憑證，可能已經被刪除')

    ctx.audit({
      entity: 'credential',
      entityId: id,
      summary: `刪除自己的 passkey「${removed.deviceLabel ?? '未命名'}」`,
      before: { deviceLabel: removed.deviceLabel, createdAt: removed.createdAt },
    })
    // 憑證被刪除要推播 —— 若不是你做的，代表有人動了你的存取控制
    void sendNtfyQuiet({
      channel: 'security',
      title: 'passkey 已被刪除',
      message: `「${removed.deviceLabel ?? '未命名'}」已從 ${ctx.user.username} 移除。若不是你本人操作，請立刻更換密碼。`,
      priority: 4,
      tags: ['warning'],
    })
    refresh()
    return { label: removed.deviceLabel ?? '未命名' }
  })

export const renameMyCredential = authedAction
  .metadata({ name: 'passkey.rename' })
  .inputSchema(
    z.object({
      id: z.coerce.number().int().positive(),
      label: z.string().trim().min(1, '請填寫名稱').max(40, '名稱不能超過 40 字'),
    }),
  )
  .action(async ({ parsedInput: { id, label }, ctx }) => {
    const row = renameCredential(ctx.user.username, id, label)
    if (!row) throw new ActionError('找不到這筆憑證，可能已經被刪除')

    ctx.audit({
      entity: 'credential',
      entityId: id,
      summary: `將 passkey 改名為「${label}」`,
    })
    refresh()
    return { label }
  })
