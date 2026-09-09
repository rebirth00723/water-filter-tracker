import { PageHeader } from '@/components/PageHeader'
import { PasskeyManager, type PasskeyState } from '@/components/passkey/PasskeyManager'
import { requireUser } from '@/lib/auth/require'
import { fmtDateOnly } from '@/lib/date'
import { listCredentials, parseTransports, passkeyUsable } from '@/lib/auth/passkey'

export const metadata = { title: '快速登入 · 淨水器記錄' }

export default async function LoginSettingsPage() {
  const user = await requireUser()
  const usable = passkeyUsable()

  const state: PasskeyState = {
    usable: usable.ok,
    reason: usable.reason,
    // 憑證清單即使在不可用時也顯示 —— 換網域之後使用者需要看到「這些已經失效了」
    rows: listCredentials(user.username).map((c) => ({
      id: c.id,
      deviceLabel: c.deviceLabel,
      createdLabel: fmtDateOnly(c.createdAt),
      lastUsedLabel: c.lastUsedAt === null ? null : fmtDateOnly(c.lastUsedAt),
      transports: parseTransports(c.transports),
    })),
  }

  return (
    <>
      <PageHeader title="快速登入" />
      <div className="px-4 py-5 md:px-8">
        <PasskeyManager state={state} />
      </div>
    </>
  )
}
