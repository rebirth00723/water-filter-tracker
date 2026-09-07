import { AuthShell, ErrorNote, FieldLabel, buttonClass, inputClass } from '@/components/AuthShell'
import { authMessage } from '@/lib/auth/messages'
import { requireSessionAllowingPasswordChange } from '@/lib/auth/require'

export const dynamic = 'force-dynamic'
export const metadata = { title: '修改密碼 · 淨水器記錄' }

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const user = await requireSessionAllowingPasswordChange()
  const { error } = await searchParams
  const forced = user.mustChangePassword

  return (
    <AuthShell
      title={forced ? '請設定新密碼' : '修改密碼'}
      description={forced ? '你是以臨時密碼登入的，設定新密碼後才能繼續使用。' : undefined}
    >
      <form
        method="POST"
        action="/api/auth/change-password"
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        {/* 密碼管理器需要一個 username 欄位才能正確關聯與儲存 */}
        <input type="hidden" name="username" autoComplete="username" value={user.username} readOnly />

        {!forced && (
          <div className="space-y-1.5">
            <FieldLabel htmlFor="current">目前的密碼</FieldLabel>
            <input
              id="current"
              name="current"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <FieldLabel htmlFor="password">新密碼</FieldLabel>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground">至少 8 個字元。</p>
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="confirm">再輸入一次</FieldLabel>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            className={inputClass}
          />
        </div>

        {error && <ErrorNote>{authMessage(error)}</ErrorNote>}

        <button type="submit" className={buttonClass}>
          設定新密碼
        </button>
      </form>
    </AuthShell>
  )
}
