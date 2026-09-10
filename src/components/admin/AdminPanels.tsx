'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { KeyRound, Lock, Play, RefreshCw, Send, Server } from 'lucide-react'
import { useAction } from 'next-safe-action/hooks'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  adminSetPassword,
  regenSessionKey,
  saveNtfyConfig,
  savePublicUrl,
  sendTestNotification,
  triggerSweep,
} from '@/app/(app)/admin/actions'
import { actionErrorMessage } from '@/components/forms/action-feedback'
import { ConfirmButton } from '@/components/forms/ConfirmButton'
import { FormActions, FormError } from '@/components/forms/FormShell'
import { Badge, Button, Card, CheckboxRow, Field, Input } from '@/components/ui'
import { ntfyConfigSchema } from '@/lib/schemas/notify'
import { PasskeyAdminPanel, type AdminCredential } from './PasskeyAdminPanel'

export interface AdminState {
  openMode: boolean
  username: string
  publicUrl: string | null
  publicUrlEnvLocked: boolean
  ntfy: {
    url: string | null
    topicFilter: string | null
    topicSecurity: string | null
    /** 只回報「有沒有」，不回顯值 */
    hasToken: boolean
    hasBasicAuth: boolean
    envLocked: string[]
  }
  passkey: { eligible: boolean; reason?: string; enabled: boolean }
  credentials: AdminCredential[]
  /** 設了 SESSION_SECRET 時「重新產生」不可能生效，按鈕要停用並說明 */
  sessionSecretEnvControlled: boolean
}

/** 由環境變數控制的欄位要唯讀並明確標示，而不是讓人填了卻不生效 */
function EnvLocked({ name }: { name: string }) {
  return (
    <Badge tone="muted" className="ml-1">
      由 {name} 控制
    </Badge>
  )
}

export function AdminPanels({ state }: { state: AdminState }) {
  return (
    <div className="space-y-6">
      {state.openMode && <OpenModeNotice />}
      <PublicUrlPanel state={state} />
      <NtfyPanel state={state} />
      <SweepPanel />
      <PasswordPanel openMode={state.openMode} username={state.username} />
      <PasskeyAdminPanel
        passkey={state.passkey}
        credentials={state.credentials}
        openMode={state.openMode}
      />
      <SessionKeyPanel envControlled={state.sessionSecretEnvControlled} />
    </div>
  )
}

function OpenModeNotice() {
  return (
    <Card className="border-warning/40 bg-warning/10 px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
        <Lock className="size-4" aria-hidden />
        目前是「無密碼」模式
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        任何能連到這個網址的人都能讀寫全部資料。這個模式下管理中心不要求登入 ——
        因為本來就沒有登入層，而這裡是事後補設密碼的唯一入口。
        <br />
        要啟用 passkey 必須先有密碼（passkey 綁定裝置與網域，密碼是唯一的退路）。
      </p>
    </Card>
  )
}

function PublicUrlPanel({ state }: { state: AdminState }) {
  const [value, setValue] = useState(state.publicUrl ?? '')
  const save = useAction(savePublicUrl, {
    onSuccess: ({ data }) => {
      // 有自動修正的話要說出來，否則使用者不會知道存進去的與他打的不一樣
      toast.success(`已儲存對外網址${data.note}`, { duration: data.note ? 10_000 : 4000 })
      setValue(data.publicUrl ?? '')
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        對外網址
        {state.publicUrlEnvLocked && <EnvLocked name="PUBLIC_URL" />}
      </h2>
      <Card className="space-y-3 px-4 py-3.5">
        <Field
          label="網址"
          htmlFor="admin-public-url"
          hint="用於 QR Code、通知的點擊連結，以及 passkey 的來源比對。含協定，例如 https://water.example.com"
        >
          <Input
            id="admin-public-url"
            placeholder="https://water.example.com"
            value={value}
            disabled={state.publicUrlEnvLocked}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
        </Field>
        <p className="text-xs leading-relaxed text-warning">
          改動會使所有既有的 passkey 失效 —— passkey 綁定網域，換網域就要全部重新註冊。
        </p>
        <FormError message={save.result?.serverError} />
        <Button
          size="sm"
          disabled={state.publicUrlEnvLocked || save.isPending}
          onClick={() => save.execute({ publicUrl: value })}
        >
          {save.isPending ? '儲存中…' : '儲存'}
        </Button>
      </Card>
    </section>
  )
}

type NtfyIn = z.input<typeof ntfyConfigSchema>

function NtfyPanel({ state }: { state: AdminState }) {
  const locked = (key: string) => state.ntfy.envLocked.includes(key)

  const form = useForm<NtfyIn, unknown, NtfyIn>({
    resolver: zodResolver(ntfyConfigSchema, undefined, { raw: true }),
    defaultValues: {
      url: state.ntfy.url ?? '',
      topicFilter: state.ntfy.topicFilter ?? '',
      topicSecurity: state.ntfy.topicSecurity ?? '',
      token: '',
      user: '',
      password: '',
      clearAuth: false,
    },
  })

  const save = useAction(saveNtfyConfig, {
    onSuccess: ({ data }) => {
      toast.success(data.message)
      form.reset({ ...form.getValues(), token: '', user: '', password: '', clearAuth: false })
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })
  const test = useAction(sendTestNotification, {
    onSuccess: ({ data }) => toast.success(data.message),
    onError: ({ error }) => toast.error(actionErrorMessage(error), { duration: 12_000 }),
  })

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <Server className="size-4" aria-hidden />
        ntfy 連線
      </h2>
      <Card className="px-4 py-3.5">
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => save.execute(v))}
        >
          <Field
            label={
              <>
                伺服器網址
                {locked('ntfy.url') && <EnvLocked name="NTFY_URL" />}
              </>
            }
            htmlFor="ntfy-url"
            error={form.formState.errors.url?.message}
            hint="不含 topic。JSON 發布會送到根路徑，填成含 topic 的網址會得到 404"
          >
            <Input
              id="ntfy-url"
              placeholder="http://ntfy:80"
              disabled={locked('ntfy.url')}
              {...form.register('url')}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="濾心提醒 topic"
              htmlFor="ntfy-topic-filter"
              error={form.formState.errors.topicFilter?.message}
            >
              <Input
                id="ntfy-topic-filter"
                placeholder="water-filter"
                disabled={locked('ntfy.topicFilter')}
                {...form.register('topicFilter')}
              />
            </Field>
            <Field
              label="安全通知 topic"
              htmlFor="ntfy-topic-security"
              error={form.formState.errors.topicSecurity?.message}
            >
              <Input
                id="ntfy-topic-security"
                placeholder="water-filter-security"
                disabled={locked('ntfy.topicSecurity')}
                {...form.register('topicSecurity')}
              />
            </Field>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            分成兩個 topic 是為了讓「該換濾心了」和「有人註冊了新裝置」在 ntfy app
            裡是兩條分開的訊息流 —— 混在一起會讓後者被前者淹沒。認證兩者共用。
          </p>

          <fieldset className="space-y-3 rounded-md border border-border px-3 py-3">
            <legend className="px-1 text-sm font-medium">
              認證
              {state.ntfy.hasToken && <Badge tone="success" className="ml-1.5">已設 token</Badge>}
              {state.ntfy.hasBasicAuth && <Badge tone="success" className="ml-1.5">已設帳密</Badge>}
            </legend>
            <p className="text-xs leading-relaxed text-muted-foreground">
              <strong className="text-foreground">建議用 token</strong>：外洩時可單獨撤銷那一把，
              而帳密外洩要改整個 ntfy 帳號的密碼，會影響其他用途。兩者都設時 token 優先。
              <br />
              <strong className="text-foreground">已存的值不會回顯</strong>，留空代表不變更。
            </p>
            <Field label="Access token" htmlFor="ntfy-token" error={form.formState.errors.token?.message}>
              <Input
                id="ntfy-token"
                type="password"
                autoComplete="off"
                placeholder={state.ntfy.hasToken ? '（已設定，留空不變更）' : 'tk_...'}
                disabled={locked('ntfy.token')}
                {...form.register('token')}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="帳號" htmlFor="ntfy-user" error={form.formState.errors.user?.message}>
                <Input id="ntfy-user" autoComplete="off" disabled={locked('ntfy.user')} {...form.register('user')} />
              </Field>
              <Field label="密碼" htmlFor="ntfy-password" error={form.formState.errors.password?.message}>
                <Input
                  id="ntfy-password"
                  type="password"
                  autoComplete="off"
                  placeholder={state.ntfy.hasBasicAuth ? '（已設定，留空不變更）' : ''}
                  disabled={locked('ntfy.password')}
                  {...form.register('password')}
                />
              </Field>
            </div>
            <CheckboxRow label="清除已設定的認證" {...form.register('clearAuth')} />
            <p className="text-xs text-muted-foreground">
              認證存在資料庫裡，<strong className="text-warning">是明文</strong>。
              能拿來加密的只有同一個目錄下的 session 金鑰 ——
              拿得到其中一個的人通常兩個都拿得到，加密只是心理安慰。
            </p>
          </fieldset>

          <FormError message={save.result?.serverError} />
          <FormActions pending={save.isPending} submitLabel="儲存 ntfy 設定" />
        </form>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={test.isPending}
            onClick={() => test.execute({ channel: 'filter' })}
          >
            <Send className="size-4" aria-hidden />
            測試濾心 topic
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={test.isPending}
            onClick={() => test.execute({ channel: 'security' })}
          >
            <Send className="size-4" aria-hidden />
            測試安全 topic
          </Button>
        </div>
        {test.result?.serverError && (
          <p role="alert" className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {test.result.serverError}
          </p>
        )}
      </Card>
    </section>
  )
}

function SweepPanel() {
  const run = useAction(triggerSweep, {
    onSuccess: ({ data }) =>
      toast.success(
        `掃描完成：${data.scanned} 項到期、送出 ${data.sent} 則` +
          (data.failed ? `、失敗 ${data.failed} 則` : ''),
        { description: data.notes.join('；') || undefined, duration: 10_000 },
      ),
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">手動觸發通知掃描</h2>
      <Card className="space-y-3 px-4 py-3.5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          跳過「發送時刻還沒到」這個條件立刻掃一次。
          <strong className="text-foreground">不會跳過去重</strong> ——
          按第二次的送出數應該是 0，那也是驗證冪等性的方法。
        </p>
        <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => run.execute({})}>
          <Play className="size-4" aria-hidden />
          {run.isPending ? '掃描中…' : '立刻掃描'}
        </Button>
        {run.result?.data && (
          <div className="rounded-md bg-muted px-3 py-2 text-xs">
            <p className="tabular">
              掃描 {run.result.data.scanned} 項 · 送出 {run.result.data.sent} · 失敗{' '}
              {run.result.data.failed} · 略過 {run.result.data.skipped} · 重試{' '}
              {run.result.data.retried}
            </p>
            {run.result.data.notes.map((n) => (
              <p key={n} className="mt-1 text-muted-foreground">
                {n}
              </p>
            ))}
          </div>
        )}
      </Card>
    </section>
  )
}

const pwSchema = z.object({ password: z.string(), confirm: z.string() })

function PasswordPanel({ openMode, username }: { openMode: boolean; username: string }) {
  const form = useForm<z.input<typeof pwSchema>>({ defaultValues: { password: '', confirm: '' } })
  const save = useAction(adminSetPassword, {
    onSuccess: ({ data }) => {
      toast.success(
        data.wasOpen ? '已設定密碼，系統已切換為密碼模式' : '已修改密碼',
        { description: '所有裝置都需要重新登入' },
      )
      form.reset()
    },
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <KeyRound className="size-4" aria-hidden />
        {openMode ? '設定密碼' : '修改密碼'}
      </h2>
      <Card className="px-4 py-3.5">
        {/* 真正的 form + autocomplete，密碼管理器才會提議儲存 */}
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => save.execute(v))}
        >
          {/* 隱藏的使用者名稱欄位：少了它，多數密碼管理器的儲存與自動填入會變差 */}
          <input type="hidden" name="username" autoComplete="username" value={username} readOnly />
          <Field label="新密碼" htmlFor="admin-pw" required>
            <Input
              id="admin-pw"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
          </Field>
          <Field label="再輸入一次" htmlFor="admin-pw2" required>
            <Input
              id="admin-pw2"
              type="password"
              autoComplete="new-password"
              {...form.register('confirm')}
            />
          </Field>
          {openMode && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              設定之後系統會切換為密碼模式，所有頁面都會要求登入。
            </p>
          )}
          <FormError
            message={
              save.result?.serverError ??
              save.result?.validationErrors?.fieldErrors?.password?.[0] ??
              save.result?.validationErrors?.fieldErrors?.confirm?.[0]
            }
          />
          <FormActions pending={save.isPending} submitLabel={openMode ? '設定密碼' : '修改密碼'} />
        </form>
      </Card>
    </section>
  )
}

function SessionKeyPanel({ envControlled }: { envControlled: boolean }) {
  const regen = useAction(regenSessionKey, {
    onSuccess: () => toast.success('已重新產生 session 金鑰，所有裝置已登出'),
    onError: ({ error }) => toast.error(actionErrorMessage(error)),
  })

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <RefreshCw className="size-4" aria-hidden />
        session 金鑰
      </h2>
      <Card className="space-y-3 px-4 py-3.5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          簽署登入通行證用的印章，首次啟動時自動產生在資料目錄下。
        </p>
        {/*
          後果直接寫在按鈕旁，不藏在說明文件或按下去之後的對話框裡 ——
          使用者最怕的是「按下去會不會連 passkey 都要重設」，
          沒寫清楚就不敢按，那這個功能等於不存在。
        */}
        <p className="text-xs leading-relaxed">
          重新產生後，<strong>所有已登入的裝置都會被登出</strong>，需要重新登入。
          <br />
          <strong>passkey 本身不受影響，不必重新註冊。</strong>
        </p>

        {envControlled ? (
          /*
           * 設了 SESSION_SECRET 時這個動作不可能生效：key() 會優先讀環境變數，
           * 所以寫一個新的金鑰檔完全不會被讀到 —— 當下看似成功，
           * 但下一次重啟舊金鑰就回來了，撤銷被靜默還原。
           * 停用並說明，比讓人按下去得到一個假的成功好。
           */
          <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5">
            <p className="text-xs font-medium text-warning">
              由環境變數 <code className="font-mono">SESSION_SECRET</code> 控制，無法從這裡重新產生
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              請在部署設定裡換掉那個值並重新啟動。
              若只是想登出所有裝置，用「設定」頁的<strong>登出所有裝置</strong> ——
              它遞增 tokenVersion，不受這個限制。
            </p>
          </div>
        ) : (
        <ConfirmButton
          label="重新產生金鑰"
          variant="secondary"
          title="重新產生 session 金鑰？"
          description={
            <>
              所有已登入的裝置（含這一台）都會立刻被登出，需要重新登入。
              <br />
              passkey 不受影響，不必重新註冊。
              <br />
              懷疑金鑰外洩、或想強制所有裝置重新登入時使用。
            </>
          }
          confirmLabel="重新產生"
          pending={regen.isPending}
          onConfirm={() => regen.execute({})}
        />
        )}
      </Card>
    </section>
  )
}
