'use client'

import { startAuthentication } from '@simplewebauthn/browser'
import { Fingerprint } from 'lucide-react'
import { useEffect, useState } from 'react'
import { withBasePath } from '@/lib/base-path'
import { buttonClass } from '@/components/ui'

/**
 * 登入頁的 passkey 快捷。
 *
 * **只有在真的可用時才渲染。** 條件包含瀏覽器支援、伺服端已啟用、
 * 而且這個帳號至少註冊過一把 —— 少了任何一項就不顯示，
 * 因為一個按下去必定失敗的按鈕比沒有按鈕更糟：使用者會以為系統壞了，
 * 而真正該做的事（打密碼）就在它下面。
 *
 * 瀏覽器支援的檢查只能在客戶端做，所以這個元件會先渲染成 null 再出現 ——
 * 那個閃動是可接受的，換來的是不會顯示一個假的入口。
 */
export function PasskeyLoginButton({ next }: { next?: string }) {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // 瀏覽器不支援就不必問伺服器
      if (typeof window === 'undefined' || !window.PublicKeyCredential) return
      try {
        const res = await fetch(withBasePath('/api/auth/passkey/login'))
        // 409 代表「passkey 未啟用」或「還沒註冊過」—— 兩者都不該顯示按鈕
        if (!cancelled && res.ok) setReady(true)
      } catch {
        // 網路錯誤時不顯示。密碼那條路仍然可用
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) return null

  async function login() {
    setBusy(true)
    setError(null)
    try {
      const optRes = await fetch(withBasePath('/api/auth/passkey/login'))
      const optJson = (await optRes.json()) as
        | { ok: true; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }
        | { ok: false; message: string }
      if (!optJson.ok) {
        setError(optJson.message)
        return
      }

      const assertion = await startAuthentication({ optionsJSON: optJson.options })

      const verifyRes = await fetch(withBasePath('/api/auth/passkey/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: assertion }),
      })
      const verifyJson = (await verifyRes.json()) as { ok: boolean; message?: string }
      if (!verifyJson.ok) {
        // 伺服端一律回同一個失敗代碼，這裡也不多說 —— 見 lib/auth/messages
        setError('登入失敗，請改用密碼')
        return
      }

      /*
       * 用整頁導向而不是 router.push：session cookie 是伺服端設的，
       * 而客戶端路由不會重新跑 layout 的授權檢查，
       * 於是會停在登入頁上一個「已經登入但畫面沒變」的狀態。
       */
      window.location.assign(withBasePath(next && next.startsWith('/') && !next.startsWith('//') ? next : '/'))
    } catch (err) {
      const e = err as { name?: string }
      // 使用者按取消不是錯誤
      if (e.name === 'NotAllowedError') return
      setError('這台裝置的 passkey 無法使用，請改用密碼')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={busy}
        onClick={login}
        className={buttonClass('secondary', 'md', 'w-full')}
      >
        <Fingerprint className="size-5" aria-hidden />
        {busy ? '等待驗證器…' : '用這台裝置登入'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-center text-xs text-destructive">
          {error}
        </p>
      )}
      <p className="mt-2 text-center text-xs text-muted-foreground">
        或用下方的密碼登入
      </p>
    </div>
  )
}
