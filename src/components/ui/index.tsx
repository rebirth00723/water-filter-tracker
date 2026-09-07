import { cn } from '@/lib/utils'

/**
 * 手寫的基本元件，沿用 globals.css 裡已調好的色彩 token。
 *
 * 刻意不跑 shadcn CLI：它會改寫 globals.css 的變數命名與暗色模式做法，
 * 與現有那份手調的繁中字體堆疊與圖表色衝突，收拾的成本高於自己寫這幾個元件。
 *
 * 觸控目標一律 ≥44px（h-11）—— 手機優先的前提下這不是美觀問題，
 * 而是站在水槽邊單手操作時點不點得中的問題。
 */

export const inputClass =
  'h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none ' +
  'placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:opacity-60 disabled:cursor-not-allowed'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium ' +
  'transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:pointer-events-none disabled:opacity-50'

const BUTTON_VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-input bg-card hover:bg-muted',
  ghost: 'hover:bg-muted',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
} as const

const BUTTON_SIZES = {
  sm: 'h-9 px-3',
  md: 'h-11 px-4',
  icon: 'h-11 w-11',
} as const

export function buttonClass(
  variant: keyof typeof BUTTON_VARIANTS = 'primary',
  size: keyof typeof BUTTON_SIZES = 'md',
  extra?: string,
) {
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra)
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: React.ComponentProps<'button'> & {
  variant?: keyof typeof BUTTON_VARIANTS
  size?: keyof typeof BUTTON_SIZES
}) {
  return <button className={buttonClass(variant, size, className)} {...rest} />
}

export function Input({ className, ...rest }: React.ComponentProps<'input'>) {
  return <input className={cn(inputClass, className)} {...rest} />
}

export function Textarea({ className, ...rest }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(inputClass, 'h-auto min-h-20 resize-y py-2 leading-relaxed', className)}
      {...rest}
    />
  )
}

export function Select({ className, ...rest }: React.ComponentProps<'select'>) {
  return <select className={cn(inputClass, 'pr-8', className)} {...rest} />
}

/** 標籤 + 提示 + 錯誤。錯誤訊息掛 role="alert"，螢幕閱讀器才會念出來 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  /** ReactNode 而不是 string：標籤旁常要掛一個「由環境變數控制」的徽章 */
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-1 text-sm font-medium">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function Card({ className, ...rest }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card', className)}
      {...rest}
    />
  )
}

export function SectionTitle({
  title,
  hint,
  action,
}: {
  title: string
  hint?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

/**
 * 空狀態。這個 App 刻意不預載任何耗材品項，所以空狀態是**每個使用者
 * 都一定會看到的第一個畫面** —— 它必須說清楚下一步要做什麼，不能只寫「沒有資料」。
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function Badge({
  tone = 'muted',
  className,
  ...rest
}: React.ComponentProps<'span'> & {
  tone?: 'muted' | 'warning' | 'danger' | 'success' | 'accent'
}) {
  const tones = {
    muted: 'bg-muted text-muted-foreground',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-destructive/15 text-destructive',
    success: 'bg-success/15 text-success',
    accent: 'bg-accent text-accent-foreground',
  } as const
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...rest}
    />
  )
}

/**
 * 開關列。用原生 checkbox 而不是自繪的 switch：
 * 原生元件天生有鍵盤操作、螢幕閱讀器狀態與表單語意，
 * 自己畫一個要補回這三件事，而它們正是最容易被漏掉的部分。
 *
 * 整列都是 label，所以點文字也能切換 —— 在手機上這是很大的差別。
 */
export function CheckboxRow({
  label,
  hint,
  className,
  ...rest
}: React.ComponentProps<'input'> & { label: string; hint?: React.ReactNode }) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-input px-3 py-2.5',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
        className,
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
        {...rest}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}

/**
 * 列表列的樣式。做成字串而不是只有元件，是為了讓整列可點的情況能把它
 * 直接套在 `<Link>` 上 —— 用 `display: contents` 包一層 Link 會讓連結
 * 在部分瀏覽器失去可點擊性與鍵盤焦點，那是實際的無障礙缺陷而不只是風格問題。
 */
export const rowClass =
  'flex min-h-14 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0'

export function Row({ className, ...rest }: React.ComponentProps<'div'>) {
  return <div className={cn(rowClass, className)} {...rest} />
}

/** 種類的顏色圓點。泳道與挑選器共用同一個視覺，使用者才對得起來 */
export function ColorDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-3 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color }}
    />
  )
}
