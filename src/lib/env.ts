import { readFileSync } from 'node:fs'

/**
 * 讀取環境變數，並支援 `<NAME>_FILE` 形式（docker secret）。
 * 檔案優先：憑證類的值不該出現在 docker inspect 與 shell 歷史中。
 */
export function env(name: string): string | undefined {
  const file = process.env[`${name}_FILE`]?.trim()
  if (file) {
    try {
      const v = readFileSync(file, 'utf8').trim()
      return v === '' ? undefined : v
    } catch (err) {
      throw new Error(
        `無法讀取 ${name}_FILE 指向的檔案「${file}」：${(err as Error).message}。` +
          `請確認該檔案存在、已掛載進容器，且容器的執行身分（compose 的 user: 欄位）有讀取權限。`,
      )
    }
  }
  const v = process.env[name]?.trim()
  return v === '' ? undefined : v
}

export function envRequired(name: string, hint?: string): string {
  const v = env(name)
  if (!v) throw new Error(`缺少必要設定 ${name}${hint ? `。${hint}` : ''}`)
  return v
}

export function envInt(name: string, fallback: number): number {
  const v = env(name)
  if (v === undefined) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${name} 必須是數字，目前是「${v}」`)
  return n
}

export function envBool(name: string, fallback: boolean): boolean {
  const v = env(name)?.toLowerCase()
  if (v === undefined) return fallback
  return v === 'true' || v === '1' || v === 'yes'
}
