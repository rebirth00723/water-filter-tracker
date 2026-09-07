/**
 * 登入失敗一律回同一句訊息，不區分「帳號不存在」與「密碼錯誤」——
 * 區分開來等於告訴對方哪些帳號存在。
 */
export const GENERIC_LOGIN_ERROR = '帳號或密碼錯誤，請再試一次。'

/**
 * 登入失敗只有這一個代碼。
 *
 * 不可以為「密碼錯」與「被限流」分開設碼 —— 即使兩者顯示同一句話，
 * **網址上的代碼本身就是可觀測的差異**：攻擊者能藉此分辨自己是否打到了
 * 真實存在且正在被限流的帳號，並據以調整節奏。
 * 真正的原因只寫進 audit_log 與容器日誌。
 */
export const LOGIN_FAILED = 'login_failed'

export const AUTH_MESSAGES: Record<string, string> = {
  [LOGIN_FAILED]: GENERIC_LOGIN_ERROR,
  revoked: '你的登入階段已失效，請重新登入。',
  password_mismatch: '兩次輸入的密碼不一致。',
  password_weak: '密碼至少需要 8 個字元。',
  password_same_as_temp: '新密碼不能與臨時密碼相同。',
  username_invalid: '使用者名稱只能使用英數字、底線、句點與連字號，最長 32 字元。',
  already_initialized: '系統已經初始化過了。',
  current_password_wrong: '目前的密碼不正確。',
}

export function authMessage(code: string | undefined): string | undefined {
  if (!code) return undefined
  return AUTH_MESSAGES[code] ?? '操作失敗，請再試一次。'
}
