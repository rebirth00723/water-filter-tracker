import { PageHeader } from '@/components/PageHeader'
import { DataTransfer } from '@/components/settings/DataTransfer'

export default function DataSettingsPage() {
  return (
    <>
      <PageHeader title="匯出與匯入" />
      <div className="px-4 py-5 md:px-8">
        <DataTransfer />
      </div>
    </>
  )
}
