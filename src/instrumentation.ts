export async function register() {
  // register() 在 Node.js 與 Edge runtime 會各被呼叫一次，這是最常見的重複執行來源
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // 靜態字串路徑：讓 standalone 的 output file tracing 追得到
  const { boot } = await import('./lib/boot')
  boot()
}
