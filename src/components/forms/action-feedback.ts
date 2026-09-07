'use client'

/**
 * next-safe-action 的錯誤結果 → 一句可讀的中文。
 *
 * 三種錯誤來源要分開處理，因為它們代表完全不同的狀況：
 * - `validationErrors`：輸入不合法。正常情況下客戶端的 zod 已經先擋掉，
 *   走到這裡通常是有人直接 POST 這個端點，或客戶端與伺服端的 schema 不同步。
 * - `serverError`：伺服端刻意丟出的 ActionError，訊息本來就是寫給使用者看的。
 * - `thrownError`：連 action 都沒跑起來（例如網路斷了）。
 */
export function actionErrorMessage(error: {
  serverError?: string
  validationErrors?: unknown
  thrownError?: Error
}): string {
  if (error.serverError) return error.serverError

  const ve = error.validationErrors as
    | { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> }
    | undefined
  if (ve) {
    const first =
      ve.formErrors?.[0] ??
      Object.values(ve.fieldErrors ?? {}).flatMap((v) => v ?? [])[0]
    if (first) return first
    return '輸入的資料不合法'
  }

  if (error.thrownError) return '連線失敗，請確認網路後再試一次'
  return '操作失敗，請稍後再試'
}
