import { seeOther } from '@/lib/http'
import { audit } from '@/lib/audit'
import { clientIp, userAgent } from '@/lib/auth/client-ip'
import { clearSession, currentSession } from '@/lib/auth/session'
import { bumpTokenVersion } from '@/lib/auth/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await currentSession()
  const allDevices = new URL(req.url).searchParams.get('all') === '1'

  if (session && allDevices) bumpTokenVersion(session.username)
  await clearSession()

  audit({
    action: 'logout',
    username: session?.username ?? null,
    ip: await clientIp(),
    userAgent: await userAgent(),
    summary: allDevices ? '登出所有裝置' : '登出',
  })

  return seeOther('/login')
}
