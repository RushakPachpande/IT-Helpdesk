import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import { Button, Card, EmptyState, Input, PageHeader, PageLoader, Select, Table, Td, Th } from '@/components/ui'

interface AuditEntry {
  id: string
  action: string
  entityType: string
  entityId: string | null
  details: unknown
  createdAt: string
  actor: { name: string; email: string } | null
}

const ENTITY_TYPES = ['user', 'domain', 'ticket', 'category', 'priority', 'settings', 'mailbox']

export function AuditPage() {
  const [page, setPage] = useState(1)
  const [entityType, setEntityType] = useState('')
  const [action, setAction] = useState('')
  const params = new URLSearchParams({ page: String(page) })
  if (entityType) params.set('entityType', entityType)
  if (action.trim()) params.set('action', action.trim())
  const q = useQuery({
    queryKey: ['audit', params.toString()],
    queryFn: () => api<{ entries: AuditEntry[]; total: number; pageSize: number }>(`/api/admin/audit?${params}`),
    placeholderData: keepPreviousData,
  })
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1

  return (
    <div>
      <PageHeader title="Audit log" description="Who changed what, newest first." />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Select className="w-44" value={entityType} onChange={(e) => (setEntityType(e.target.value), setPage(1))} aria-label="Entity filter">
            <option value="">All entities</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Input className="max-w-xs" placeholder="Action contains, e.g. password" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} />
        </div>
        {q.isLoading ? (
          <PageLoader />
        ) : !q.data?.entries.length ? (
          <EmptyState title="No entries" />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Details</Th></tr>
              </thead>
              <tbody>
                {q.data.entries.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(e.createdAt)}</Td>
                    <Td className="text-sm">{e.actor ? e.actor.name : <span className="text-slate-400">System</span>}</Td>
                    <Td><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{e.action}</code></Td>
                    <Td className="max-w-md">
                      {e.details != null && (
                        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-600">{JSON.stringify(e.details)}</pre>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex items-center justify-end gap-2 px-4 py-3 text-sm text-slate-500">
              <Button size="icon" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
              <span>Page {page} of {totalPages}</span>
              <Button size="icon" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
