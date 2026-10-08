import { useEffect, useMemo, useRef } from 'react'
import { FileText, Paperclip, X } from 'lucide-react'
import { fileSize } from '@/lib/utils'
import type { Meta } from '@/lib/types'

export function FilePicker({
  files,
  onChange,
  limits,
  compact,
}: {
  files: File[]
  onChange: (files: File[]) => void
  limits: Meta['attachments']
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const previews = useMemo(() => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)), [files])
  useEffect(() => () => previews.forEach((p) => p && URL.revokeObjectURL(p)), [previews])

  function add(list: FileList | null) {
    if (!list) return
    const next = [...files]
    for (const f of Array.from(list)) {
      if (next.length >= limits.maxFilesPerMessage) break
      next.push(f)
    }
    onChange(next)
    if (inputRef.current) inputRef.current.value = ''
  }

  const tooBig = files.filter((f) => f.size > limits.maxFileMb * 1024 * 1024)
  const badType = files.filter((f) => f.type && !limits.allowedMimeTypes.includes(f.type))

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={limits.allowedMimeTypes.join(',')}
        className="hidden"
        onChange={(e) => add(e.target.files)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={files.length >= limits.maxFilesPerMessage}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
        >
          <Paperclip className="h-4 w-4" /> {compact ? 'Attach' : 'Add screenshots or files'}
        </button>
        {!compact && (
          <span className="text-xs text-slate-500">
            Up to {limits.maxFilesPerMessage} files, {limits.maxFileMb} MB each
          </span>
        )}
      </div>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="group relative flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-1.5 pr-7 text-xs">
              {previews[i] ? (
                <img src={previews[i]!} alt="" className="h-10 w-10 rounded object-cover" />
              ) : (
                <FileText className="h-6 w-6 text-slate-400" />
              )}
              <div className="max-w-35">
                <p className="truncate font-medium text-slate-700">{f.name}</p>
                <p className="text-slate-500">{fileSize(f.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                aria-label={`Remove ${f.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {tooBig.length > 0 && <p className="mt-1 text-xs text-red-600">Too large: {tooBig.map((f) => f.name).join(', ')}</p>}
      {badType.length > 0 && <p className="mt-1 text-xs text-red-600">File type not allowed: {badType.map((f) => f.name).join(', ')}</p>}
    </div>
  )
}

export function filesValid(files: File[], limits: Meta['attachments']): boolean {
  return files.every((f) => f.size <= limits.maxFileMb * 1024 * 1024 && (!f.type || limits.allowedMimeTypes.includes(f.type)))
}
