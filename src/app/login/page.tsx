import { redirect } from 'next/navigation'
import { withBasePath } from '@/lib/base-path'
import { AuthShell, ErrorNote, FieldLabel, buttonClass, inputClass } from '@/components/AuthShell'
import { PasskeyLoginButton } from '@/components/passkey/PasskeyLoginButton'
import { authMessage } from '@/lib/auth/messages'
import { getAuthMode, tempPasswordPresent } from '@/lib/auth/store'

export const dynamic = 'force-dynamic'
export const metadata = { title: '登入 · 淨水器記錄' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; next?: string }>
}) {
  const mode = getAuthMode()
  if (mode === 'uninitialized') redirect('/setup')
  if (mode === 'open') redirect('/')

  const { error, reason, next } = await searchParams
  const message = authMessage(error ?? reason)

  return (
    <AuthShell title="淨水器記錄">
      {/*
        passkey 快捷放在密碼表單「之前」。
        有註冊過的人絕大多數會用它，而它自己會在不可用時消失，
        所以不會在純 HTTP 的區網上佔掉一個位置。
      */}
      <PasskeyLoginButton next={next} />

      <form
        method="POST"
        action={withBasePath('/api/auth/login')}
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        {next && <input type="hidden" name="next" value={next} />}

        <div className="space-y-1.5">
          <FieldLabel htmlFor="username">使用者名稱</FieldLabel>
          <input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="password">密碼</FieldLabel>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
          />
        </div>

        {message && <ErrorNote>{message}</ErrorNote>}

        <button type="submit" className={buttonClass}>
          登入
        </button>

        {/*
          這段文字永遠顯示，不能只在真的被鎖定時才出現——
          否則它本身就成了「這個帳號存在且已被鎖定」的訊號。
        */}
        <p className="text-center text-xs text-muted-foreground">
          連續多次失敗會暫時鎖定，請稍後再試。
        </p>
      </form>

      {tempPasswordPresent() && (
        <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
          <p className="text-xs text-warning">
            <strong>環境變數中仍設有臨時密碼。</strong>
            這組密碼會持續有效，等同永久後門。請在確認一切正常後，
            從設定檔移除 <code className="font-mono">TEMP_PASSWORD</code> 並重新啟動。
          </p>
        </div>
      )}
    </AuthShell>
  )
}
