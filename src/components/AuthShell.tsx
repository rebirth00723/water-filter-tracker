export function AuthShell({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
        </div>
        {children}
      </div>
    </main>
  )
}

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
    </label>
  )
}

export const inputClass =
  'h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-ring'

export const buttonClass =
  'h-12 w-full rounded-md bg-primary text-base font-medium text-primary-foreground ' +
  'transition-opacity disabled:opacity-50'

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  )
}
