import { eq } from 'drizzle-orm'
import { db } from './db'
import { machineConfig } from './db/schema'
import { env } from './env'

/**
 * 機器組態：對外網址、ntfy 連線等「這台機器怎麼接外面」的設定。
 *
 * **環境變數優先。** 有設環境變數時，UI 的對應欄位要顯示為唯讀並標示「由環境變數控制」，
 * 而不是讓人填了卻不生效 —— 兩處都能改同一個值卻沒有明確的優先順序提示，
 * 是這類設定最常見的困惑來源。
 */
export const CONFIG_KEYS = {
  publicUrl: 'publicUrl',
  ntfyUrl: 'ntfy.url',
  ntfyTopicFilter: 'ntfy.topicFilter',
  ntfyTopicSecurity: 'ntfy.topicSecurity',
  ntfyUser: 'ntfy.user',
  ntfyPassword: 'ntfy.password',
  ntfyToken: 'ntfy.token',
  passkeyEnabled: 'passkey.enabled',
} as const

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS]

/** 每個組態項對應的環境變數名稱；沒有對應者表示只能從 UI 設定 */
const ENV_OVERRIDE: Partial<Record<ConfigKey, string>> = {
  [CONFIG_KEYS.publicUrl]: 'PUBLIC_URL',
  [CONFIG_KEYS.ntfyUrl]: 'NTFY_URL',
  [CONFIG_KEYS.ntfyTopicFilter]: 'NTFY_TOPIC_FILTER',
  [CONFIG_KEYS.ntfyTopicSecurity]: 'NTFY_TOPIC_SECURITY',
  [CONFIG_KEYS.ntfyUser]: 'NTFY_USER',
  [CONFIG_KEYS.ntfyPassword]: 'NTFY_PASSWORD',
  [CONFIG_KEYS.ntfyToken]: 'NTFY_TOKEN',
}

function readDb(key: ConfigKey): string | undefined {
  const row = db.select().from(machineConfig).where(eq(machineConfig.key, key)).get()
  const v = row?.value?.trim()
  return v === '' ? undefined : v
}

export function getConfig(key: ConfigKey): string | undefined {
  const envName = ENV_OVERRIDE[key]
  if (envName) {
    const fromEnv = env(envName)
    if (fromEnv) return fromEnv
  }
  return readDb(key)
}

/** 該項是否由環境變數控制（UI 要據此把欄位設為唯讀） */
export function isEnvControlled(key: ConfigKey): boolean {
  const envName = ENV_OVERRIDE[key]
  return envName ? env(envName) !== undefined : false
}

export function setConfig(key: ConfigKey, value: string | null): void {
  if (isEnvControlled(key)) {
    throw new Error(`${key} 由環境變數控制，無法從介面修改`)
  }
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') {
    db.delete(machineConfig).where(eq(machineConfig.key, key)).run()
    return
  }
  db.insert(machineConfig)
    .values({ key, value: trimmed })
    .onConflictDoUpdate({
      target: machineConfig.key,
      set: { value: trimmed, updatedAt: Date.now() },
    })
    .run()
}

export function getPublicUrl(): string | undefined {
  return getConfig(CONFIG_KEYS.publicUrl)?.replace(/\/+$/, '')
}

/**
 * passkey 能不能用。RP ID 不接受 IP 位址，WebAuthn 也只在安全內容下存在，
 * 所以必須是帶網域名稱的 https。條件不滿足時 UI 要顯示原因，
 * 而不是讓人打開開關之後才發現按鈕沒反應。
 */
export function passkeyEligibility(): { eligible: boolean; reason?: string } {
  const url = getPublicUrl()
  if (!url) return { eligible: false, reason: '尚未設定對外網址（PUBLIC_URL）' }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { eligible: false, reason: `對外網址格式不正確：${url}` }
  }
  if (parsed.protocol !== 'https:') {
    return { eligible: false, reason: 'passkey 需要 https —— 這是瀏覽器的要求，不是本系統的限制' }
  }
  // RP ID 必須是網域名稱：IPv4、IPv6 與 localhost 都不合法
  const host = parsed.hostname
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  const isIpv6 = host.includes(':') || host.startsWith('[')
  if (isIpv4 || isIpv6) {
    return { eligible: false, reason: 'passkey 的 RP ID 不接受 IP 位址，必須使用網域名稱' }
  }
  if (!host.includes('.')) {
    return { eligible: false, reason: `「${host}」不是完整網域名稱` }
  }
  return { eligible: true }
}

export function isPasskeyEnabled(): boolean {
  if (!passkeyEligibility().eligible) return false
  return getConfig(CONFIG_KEYS.passkeyEnabled) === 'true'
}

export function setPasskeyEnabled(on: boolean): void {
  setConfig(CONFIG_KEYS.passkeyEnabled, on ? 'true' : null)
}
