import { Download, FileText } from 'lucide-react'
import type { AttachmentInfo } from '@/lib/types'
import { fileSize } from '@/lib/utils'

const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function AttachmentList({ items }: { items: AttachmentInfo[] }) {
  if (!items.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((a) =>
        PREVIEWABLE.has(a.mimeType) ? (
          <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-slate-200 bg-white hover:ring-2 hover:ring-blue-300">
            <img src={`/api/attachments/${a.id}`} alt={a.fileName} className="h-28 w-40 object-cover" loading="lazy" />
            <p className="max-w-40 truncate px-2 py-1 text-xs text-slate-600">{a.fileName}</p>
          </a>
        ) : (
          <a
            key={a.id}
            href={`/api/attachments/${a.id}?download=1`}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-50"
          >
            <FileText className="h-5 w-5 text-slate-400" />
            <div>
              <p className="max-w-45 truncate font-medium text-slate-700">{a.fileName}</p>
              <p className="text-slate-500">{fileSize(a.sizeBytes)}</p>
            </div>
            <Download className="h-3.5 w-3.5 text-slate-400" />
          </a>
        ),
      )}
    </div>
  )
}
