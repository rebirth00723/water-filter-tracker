import { redirect } from 'next/navigation'
import { AuthShell, ErrorNote, FieldLabel, buttonClass, inputClass } from '@/components/AuthShell'
import { authMessage } from '@/lib/auth/messages'
import { isInitialized } from '@/lib/auth/store'

export const dynamic = 'force-dynamic'
export const metadata = { title: '初始設定 · 淨水器記錄' }

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  // 初始化完成後這一頁就永久消失，而不是顯示「已設定過」——
  // 不留一個還在的入口，就沒有人需要判斷它安不安全
  if (isInitialized()) redirect('/')

  const { error } = await searchParams

  return (
    <AuthShell title="淨水器記錄" description="第一次使用，先建立你的帳號">
      <form
        method="POST"
        action="/api/auth/setup"
        className="space-y-4 rounded-lg border border-border bg-card p-5"
      >
        <div className="space-y-1.5">
          <FieldLabel htmlFor="username">使用者名稱</FieldLabel>
          <input
            id="username"
            name="username"
            defaultValue="admin"
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
            autoComplete="new-password"
            minLength={8}
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
            className={inputClass}
          />
        </div>

        {error && <ErrorNote>{authMessage(error)}</ErrorNote>}

        <button type="submit" className={buttonClass}>
          建立帳號
        </button>

        <details className="rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            我只在區網使用，不想設密碼
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              不設密碼的話，<strong>任何能連到這個網址的人都能直接使用</strong>。
              只有在你確定不會對外開放時才這樣做。日後想補設密碼，可以到「設定 → 管理」。
            </p>
            <button
              type="submit"
              name="mode"
              value="no-password"
              formNoValidate
              className="h-11 w-full rounded-md border border-border text-sm"
            >
              不設密碼，直接開始
            </button>
          </div>
        </details>
      </form>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        請在對外開放之前完成這一步。
      </p>
    </AuthShell>
  )
}
