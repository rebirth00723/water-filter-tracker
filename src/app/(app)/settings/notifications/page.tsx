import { asc } from 'drizzle-orm'
import { PageHeader } from '@/components/PageHeader'
import { NotifySettings } from '@/components/notify/NotifySettings'
import { db } from '@/lib/db'
import { notifyRules } from '@/lib/db/schema'
import { ntfyConfigured } from '@/lib/notify/ntfy'
import { failedNotifications } from '@/lib/notify/sweep'
import { SETTING_KEYS, getSetting } from '@/lib/settings'

export default function NotificationsSettingsPage() {
  const rules = db
    .select()
    .from(notifyRules)
    .orderBy(asc(notifyRules.kind), asc(notifyRules.offsetDays), asc(notifyRules.id))
    .all()

  return (
    <>
      <PageHeader title="通知規則" />
      <div className="px-4 py-5 md:px-8">
        <NotifySettings
          rules={rules}
          prefs={{
            sendTime: getSetting(SETTING_KEYS.notifySendTime, '09:00'),
            catchupMaxDays: getSetting(SETTING_KEYS.notifyCatchupMaxDays, '14'),
            auditKeepDays: getSetting(SETTING_KEYS.auditKeepDays, '180'),
          }}
          failed={failedNotifications()}
          ntfyReady={ntfyConfigured('filter')}
        />
      </div>
    </>
  )
}
