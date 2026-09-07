import { PageHeader } from '@/components/PageHeader'
import { AdminPanels, type AdminState } from '@/components/admin/AdminPanels'
import { requireAdmin } from '@/lib/auth/require'
import {
  CONFIG_KEYS,
  getConfig,
  getPublicUrl,
  isEnvControlled,
  isPasskeyEnabled,
  passkeyEligibility,
} from '@/lib/config'

export const dynamic = 'force-dynamic'
export const metadata = { title: '管理中心 · 淨水器記錄' }

/**
 * 管理中心。
 *
 * 職責與設定頁刻意分開：這裡放「這台機器怎麼接外面」的東西
 * （對外網址、ntfy 連線與認證、session 金鑰、passkey 全域開關），
 * 而設定頁放「我怎麼用這個工具」（設備、耗材、通知規則、匯出匯入）。
 * 前者換一台機器就要重填，後者跟著資料走。
 */
export default async function AdminPage() {
  const user = await requireAdmin()
  const eligibility = passkeyEligibility()

  const envLocked = (
    [
      CONFIG_KEYS.ntfyUrl,
      CONFIG_KEYS.ntfyTopicFilter,
      CONFIG_KEYS.ntfyTopicSecurity,
      CONFIG_KEYS.ntfyToken,
      CONFIG_KEYS.ntfyUser,
      CONFIG_KEYS.ntfyPassword,
    ] as const
  ).filter((k) => isEnvControlled(k))

  const state: AdminState = {
    openMode: user.openMode,
    username: user.username,
    publicUrl: getPublicUrl() ?? null,
    publicUrlEnvLocked: isEnvControlled(CONFIG_KEYS.publicUrl),
    ntfy: {
      url: getConfig(CONFIG_KEYS.ntfyUrl) ?? null,
      topicFilter: getConfig(CONFIG_KEYS.ntfyTopicFilter) ?? null,
      topicSecurity: getConfig(CONFIG_KEYS.ntfyTopicSecurity) ?? null,
      // 只回報「有沒有」。管理中心刻意不回顯已存的認證值
      hasToken: Boolean(getConfig(CONFIG_KEYS.ntfyToken)),
      hasBasicAuth: Boolean(
        getConfig(CONFIG_KEYS.ntfyUser) && getConfig(CONFIG_KEYS.ntfyPassword),
      ),
      envLocked: [...envLocked],
    },
    passkey: {
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      enabled: isPasskeyEnabled(),
    },
  }

  return (
    <>
      <PageHeader title="管理中心" />
      <div className="px-4 py-5 md:px-8">
        <AdminPanels state={state} />
      </div>
    </>
  )
}
