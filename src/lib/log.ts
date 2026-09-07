/**
 * 結構化 JSON 日誌，直接寫 stdout 供 `docker logs` grep。
 * 業務層的操作紀錄另外寫進 audit_log 表（兩者並行，用途不同）。
 */
type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < MIN) return
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...fields,
    ...(fields?.err instanceof Error
      ? { err: { name: fields.err.name, message: fields.err.message, stack: fields.err.stack } }
      : {}),
  })
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, f),
}
