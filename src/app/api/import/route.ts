import { audit } from '@/lib/audit'
import { clientIp, userAgent } from '@/lib/auth/client-ip'
import { requireUser } from '@/lib/auth/require'
import { log } from '@/lib/log'
import { importAll, importPayload, type ImportMode } from '@/lib/transfer'

export const dynamic = 'force-dynamic'

/** 上限 32MB。一份十年的紀錄大約幾百 KB，這個上限是給誤傳的檔案用的 */
const MAX_BYTES = 32 * 1024 * 1024

function bad(message: string, status = 400) {
  return Response.json({ ok: false, message }, { status })
}

/**
 * 匯入。破壞性操作，走 route handler 因為要收檔案上傳。
 *
 * 這裡是整個 App 唯一能一次改寫全部資料的入口，所以授權、
 * 大小上限與逐欄驗證三件事都不能省 —— 上傳的 JSON 是不可信輸入。
 */
export async function POST(req: Request) {
  const user = await requireUser()

  const form = await req.formData()
  const file = form.get('file')
  const mode = String(form.get('mode') ?? '') as ImportMode
  if (mode !== 'replace' && mode !== 'merge') {
    return bad('請選擇匯入模式（取代或合併）')
  }
  if (!(file instanceof File)) return bad('請選擇要匯入的 JSON 檔案')
  if (file.size === 0) return bad('檔案是空的')
  if (file.size > MAX_BYTES) {
    return bad(`檔案太大（${(file.size / 1_048_576).toFixed(1)} MB），上限是 32 MB`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    return bad('這不是合法的 JSON 檔案')
  }

  const parsed = importPayload.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return bad(
      `檔案格式不符：${first.path.join('.') || '(根)'} ${first.message}。` +
        `請確認這是本系統匯出的檔案。`,
    )
  }

  const [ip, ua] = await Promise.all([clientIp(), userAgent()])
  try {
    const result = importAll(parsed.data, mode)
    audit({
      action: 'data.import',
      username: user.username,
      ip,
      userAgent: ua,
      summary:
        `${mode === 'replace' ? '取代式' : '合併式'}匯入：` +
        `${result.devices} 台設備、${result.events} 筆耗材紀錄、${result.readings} 筆水質紀錄`,
      after: result,
    })
    return Response.json({ ok: true, ...result })
  } catch (err) {
    // 匯入在一個 transaction 裡，失敗即整筆回滾 —— 不會留下半套資料
    log.error('匯入失敗', { err })
    audit({
      action: 'data.import.fail',
      username: user.username,
      ip,
      userAgent: ua,
      summary: `匯入失敗，資料已回滾：${(err as Error).message}`,
    })
    return bad(
      `匯入失敗，資料已完整回滾（沒有留下半套資料）：${(err as Error).message}`,
      500,
    )
  }
}
