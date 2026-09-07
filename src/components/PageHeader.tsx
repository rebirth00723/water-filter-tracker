export function PageHeader({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border
                 bg-card/95 px-4 py-3.5 backdrop-blur md:px-8 md:py-5"
    >
      <h1 className="text-lg font-semibold tracking-tight md:text-xl">{title}</h1>
      {action}
    </header>
  )
}
