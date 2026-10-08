import { useEffect } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Copy, Mail, PlugZap, RefreshCw, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import { cn, formatDateTime, timeAgo } from '@/lib/utils'
import { Alert, Badge, Button, Card, CardContent, CardHeader, EmptyState, PageHeader, PageLoader, Switch, Table, Td, Th } from '@/components/ui'

type Provider = 'MICROSOFT' | 'GOOGLE'

interface MailboxInfo {
  mailbox: {
    id: string
    provider: Provider
    address: string
    displayName: string | null
    status: 'CONNECTED' | 'RECONNECT_REQUIRED' | 'DISCONNECTED' | 'ERROR'
    active: boolean
    shadowMode: boolean
    lastSyncAt: string | null
    lastError: string | null
    syncStartAt: string | null
    createdAt: string
  } | null
  events: { id: string; level: string; message: string; createdAt: string }[]
  outbound: {
    id: string
    kind: string
    status: 'QUEUED' | 'SENT' | 'FAILED' | 'SUPPRESSED'
    toEmails: string[]
    subject: string
    lastError: string | null
    attempts: number
    sentAt: string | null
    createdAt: string
    ticketId: string | null
  }[]
  isLocal: boolean
  providers: { provider: Provider; configured: boolean; redirectUri: string }[]
}

const PROVIDER_LABEL: Record<Provider, string> = { MICROSOFT: 'Microsoft 365 / Outlook', GOOGLE: 'Google Workspace / Gmail' }
const PROVIDER_SLUG: Record<Provider, string> = { MICROSOFT: 'microsoft', GOOGLE: 'google' }

export function MailboxPage() {
  const search = useSearch({ from: '/app/admin/mailbox' })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['mailbox'], queryFn: () => api<MailboxInfo>('/api/admin/mailbox'), refetchInterval: 15_000 })

  useEffect(() => {
    if (search.connected) toast.success('Mailbox connected. The first sync is running.')
    if (search.error) toast.error(search.error, { duration: 10_000 })
    if (search.connected || search.error) void navigate({ to: '/admin/mailbox', search: {}, replace: true })
  }, [search.connected, search.error, navigate])

  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mailbox'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (q.isLoading || !q.data) return <PageLoader />
  const { mailbox, providers, isLocal } = q.data
  const connected = mailbox?.status === 'CONNECTED'
  const connect = (p: Provider) => window.location.assign(`/api/admin/mailbox/connect/${PROVIDER_SLUG[p]}`)
  const localUrl = `http://localhost:${window.location.port || '80'}/admin/mailbox`

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Support mailbox" description="Connect the IT support mailbox so incoming emails become tickets and replies go out from it." />

      {!isLocal && (
        <Alert variant="warn">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Microsoft and Google only allow sign-in redirects to <strong>localhost</strong> for apps running without HTTPS. Open{' '}
              <a href={localUrl} className="font-medium underline">{localUrl}</a> on the machine that runs the helpdesk to connect or reconnect.
              Everything else on this page works from any computer.
            </div>
          </div>
        </Alert>
      )}

      {mailbox && (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Mail className="h-4 w-4" /> {mailbox.address}
              </span>
            }
            description={`${PROVIDER_LABEL[mailbox.provider]} · connected ${formatDateTime(mailbox.createdAt)}`}
            actions={
              <Badge
                className={cn(
                  connected ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800',
                )}
              >
                {connected ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {mailbox.status.replace('_', ' ').toLowerCase()}
              </Badge>
            }
          />
          <CardContent className="space-y-4">
            {mailbox.status === 'RECONNECT_REQUIRED' && (
              <Alert variant="error">Access to the mailbox expired or was revoked. Reconnect it to resume syncing and sending.</Alert>
            )}
            <div className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Last sync</p>
                <p className="font-medium">{mailbox.lastSyncAt ? timeAgo(mailbox.lastSyncAt) : 'Not yet'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Importing mail received after</p>
                <p className="font-medium">{mailbox.syncStartAt ? formatDateTime(mailbox.syncStartAt) : '-'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Last error</p>
                <p className={cn('font-medium', mailbox.lastError ? 'text-red-700' : 'text-slate-400')}>{mailbox.lastError ?? 'None'}</p>
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <Switch
                checked={mailbox.shadowMode}
                onChange={(shadowMode) => action.mutate(() => api('/api/admin/mailbox', { method: 'PATCH', body: { shadowMode } }))}
                label={<span className="font-medium">Shadow mode</span>}
              />
              <p className="mt-1 text-xs text-slate-500">
                Import emails as tickets but do not send any email. Use this while n8n is still answering the mailbox, then switch it off at cutover.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!connected} loading={action.isPending} onClick={() => action.mutate(() => api('/api/admin/mailbox/sync', { method: 'POST' }).then(() => toast.success('Sync started')))}>
                <RefreshCw className="h-4 w-4" /> Sync now
              </Button>
              <Button variant="outline" disabled={!isLocal} onClick={() => connect(mailbox.provider)}>
                <PlugZap className="h-4 w-4" /> Reconnect
              </Button>
              <Button
                variant="ghost"
                className="text-red-700 hover:bg-red-50"
                onClick={() => {
                  if (confirm('Disconnect the mailbox? Email sync and sending will stop until you connect again.')) {
                    action.mutate(() => api('/api/admin/mailbox/disconnect', { method: 'POST' }))
                  }
                }}
              >
                <Unplug className="h-4 w-4" /> Disconnect
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader
          title={mailbox ? 'Switch mailbox' : 'Connect a mailbox'}
          description="Sign in with the IT support account. Connecting a different mailbox replaces the current one."
        />
        <CardContent className="grid gap-4 md:grid-cols-2">
          {providers.map((p) => (
            <div key={p.provider} className="rounded-lg border border-slate-200 p-4">
              <p className="font-medium">{PROVIDER_LABEL[p.provider]}</p>
              {p.configured ? (
                <p className="mt-1 text-xs text-slate-500">OAuth app configured.</p>
              ) : (
                <p className="mt-1 text-xs text-amber-700">Client ID and secret are not set in the server .env file. See the README.</p>
              )}
              <div className="mt-2 flex items-center gap-1 text-xs">
                <span className="text-slate-500">Redirect URI:</span>
                <code className="truncate rounded bg-slate-100 px-1">{p.redirectUri}</code>
                <button
                  className="rounded p-1 text-slate-400 hover:bg-slate-100"
                  aria-label="Copy redirect URI"
                  onClick={() => navigator.clipboard?.writeText(p.redirectUri).then(() => toast.success('Copied'))}
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
              <Button className="mt-3 w-full" disabled={!p.configured || !isLocal} onClick={() => connect(p.provider)}>
                Sign in with {p.provider === 'MICROSOFT' ? 'Microsoft' : 'Google'}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {mailbox && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Sync activity" description="Latest 50 events" />
            {!q.data.events.length ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm">
                {q.data.events.map((e) => (
                  <li key={e.id} className="flex gap-3 px-5 py-2">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', e.level === 'error' ? 'bg-red-500' : e.level === 'warn' ? 'bg-amber-500' : 'bg-emerald-500')} />
                    <div className="min-w-0">
                      <p className="wrap-break-word text-slate-700">{e.message}</p>
                      <p className="text-xs text-slate-400">{formatDateTime(e.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Outgoing email" description="Latest 30 messages" />
            {!q.data.outbound.length ? (
              <EmptyState title="Nothing sent yet" />
            ) : (
              <Table>
                <thead>
                  <tr><Th>To / subject</Th><Th>Status</Th><Th /></tr>
                </thead>
                <tbody>
                  {q.data.outbound.map((o) => (
                    <tr key={o.id}>
                      <Td className="max-w-65">
                        <p className="truncate text-xs text-slate-500">{o.toEmails.join(', ')}</p>
                        <p className="truncate text-sm">{o.subject}</p>
                        {o.lastError && <p className="truncate text-xs text-red-700" title={o.lastError}>{o.lastError}</p>}
                      </Td>
                      <Td>
                        <Badge
                          className={cn(
                            o.status === 'SENT' && 'bg-emerald-100 text-emerald-800',
                            o.status === 'QUEUED' && 'bg-blue-100 text-blue-800',
                            o.status === 'FAILED' && 'bg-red-100 text-red-800',
                            o.status === 'SUPPRESSED' && 'bg-slate-200 text-slate-700',
                          )}
                        >
                          {o.status.toLowerCase()}
                        </Badge>
                      </Td>
                      <Td>
                        {(o.status === 'FAILED' || o.status === 'SUPPRESSED') && (
                          <Button size="sm" variant="ghost" disabled={!connected} onClick={() => action.mutate(() => api(`/api/admin/outbound/${o.id}/retry`, { method: 'POST' }))}>
                            Retry
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
