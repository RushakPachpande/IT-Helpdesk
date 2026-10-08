import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { settingsSchema, type Settings } from '@helpdesk/shared'
import { api, errorMessage } from '@/lib/api'
import { Alert, Button, Card, CardContent, CardHeader, Field, Input, PageHeader, PageLoader, Select, Switch, Textarea } from '@/components/ui'

type PublicSettings = Settings & { ai: Settings['ai'] & { hasApiKey: boolean } }

const TEMPLATE_FIELDS: { key: keyof Settings['templates']; label: string; rows?: number }[] = [
  { key: 'ackSubject', label: 'Email received: subject', rows: 1 },
  { key: 'ackBody', label: 'Email received: acknowledgement' },
  { key: 'webCreatedSubject', label: 'Web request created: subject', rows: 1 },
  { key: 'webCreatedBody', label: 'Web request created: body' },
  { key: 'replyBody', label: 'Agent reply wrapper' },
  { key: 'resolvedBody', label: 'Ticket resolved' },
  { key: 'closedBody', label: 'Ticket closed' },
  { key: 'assignedBody', label: 'Ticket assigned (to agent)' },
]

const PLACEHOLDERS = '{ticketNumber} {subject} {requesterName} {priority} {ticketUrl} {message} {agentName} {resolutionNotes} {reopenWindowDays}'

const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean)

export function SettingsPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<{ settings: PublicSettings; timezone: string }>('/api/admin/settings') })
  const [s, setS] = useState<Settings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [preview, setPreview] = useState('')

  useEffect(() => {
    if (q.data) setS(q.data.settings)
  }, [q.data])

  const format = s?.ticketId.format
  const prefix = s?.ticketId.prefix
  useEffect(() => {
    if (!format || !prefix) return
    const t = setTimeout(() => {
      api<{ preview: string }>(`/api/admin/settings/ticket-id-preview?${new URLSearchParams({ format, prefix })}`)
        .then((r) => setPreview(r.preview))
        .catch(() => setPreview(''))
    }, 300)
    return () => clearTimeout(t)
  }, [format, prefix])

  const save = useMutation({
    mutationFn: (body: Settings) => api<{ settings: PublicSettings }>('/api/admin/settings', { method: 'PUT', body }),
    onSuccess: (r) => {
      qc.setQueryData(['settings'], (old: { timezone: string } | undefined) => ({ timezone: old?.timezone ?? '', settings: r.settings }))
      setApiKey('')
      toast.success('Settings saved')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (q.isLoading || !s || !q.data) return <PageLoader />
  const hasApiKey = q.data.settings.ai.hasApiKey

  function set<K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) {
    setS((prev) => (prev ? { ...prev, [section]: { ...prev[section], ...patch } } : prev))
  }

  function submit(clearKey = false) {
    if (!s) return
    const body: Settings = { ...s, ai: { ...s.ai, apiKey: clearKey ? '__clear__' : apiKey.trim() || undefined } }
    const parsed = settingsSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      toast.error(`${issue.path.join(' > ')}: ${issue.message}`)
      return
    }
    save.mutate(parsed.data)
  }

  const num = (v: string) => (v === '' ? 0 : Number(v))

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Settings"
        description={`Times use the server timezone: ${q.data.timezone}`}
        actions={<Button onClick={() => submit()} loading={save.isPending}><Save className="h-4 w-4" /> Save changes</Button>}
      />

      <Card>
        <CardHeader title="Ticket numbers" description="Tokens: {PREFIX} {YYYY} {YY} {MM} {DD} {SEQ} or {SEQ:n} for zero-padding. The counter restarts whenever the date part changes." />
        <CardContent className="grid gap-4 lg:grid-cols-[120px_1fr_220px]">
          <Field label="Prefix">
            <Input value={s.ticketId.prefix} onChange={(e) => set('ticketId', { prefix: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Format">
            <Input value={s.ticketId.format} onChange={(e) => set('ticketId', { format: e.target.value })} className="font-mono" />
          </Field>
          <Field label="Next ticket looks like">
            <div className="flex h-9 items-center rounded-md bg-slate-100 px-3 font-mono text-sm">{preview || '-'}</div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Attachments" />
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Max file size (MB)">
            <Input type="number" min={1} max={50} value={s.attachments.maxFileMb} onChange={(e) => set('attachments', { maxFileMb: num(e.target.value) })} />
          </Field>
          <Field label="Max files per message">
            <Input type="number" min={1} max={20} value={s.attachments.maxFilesPerMessage} onChange={(e) => set('attachments', { maxFilesPerMessage: num(e.target.value) })} />
          </Field>
          <Field label="Skip inline email images under (KB)" hint="Filters out logos and signature images.">
            <Input type="number" min={0} value={s.attachments.skipInlineImagesUnderKb} onChange={(e) => set('attachments', { skipInlineImagesUnderKb: num(e.target.value) })} />
          </Field>
          <Field label="Allowed file types (MIME, one per line)" className="sm:col-span-3">
            <Textarea
              rows={5}
              className="font-mono text-xs"
              defaultValue={s.attachments.allowedMimeTypes.join('\n')}
              onBlur={(e) => set('attachments', { allowedMimeTypes: lines(e.target.value) })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Email" />
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Check mailbox every (minutes)">
              <Input type="number" min={1} max={60} value={s.email.pollIntervalMinutes} onChange={(e) => set('email', { pollIntervalMinutes: num(e.target.value) })} />
            </Field>
            <Field label="On first connect, import last (minutes)">
              <Input type="number" min={0} value={s.email.initialLookbackMinutes} onChange={(e) => set('email', { initialLookbackMinutes: num(e.target.value) })} />
            </Field>
            <Field label="Requester can reopen within (days)" hint="Later replies start a new ticket.">
              <Input type="number" min={0} value={s.email.reopenWindowDays} onChange={(e) => set('email', { reopenWindowDays: num(e.target.value) })} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Switch checked={s.email.sendAck} onChange={(v) => set('email', { sendAck: v })} label="Send acknowledgement for emailed requests" />
            <Switch checked={s.email.notifyRequesterOnReply} onChange={(v) => set('email', { notifyRequesterOnReply: v })} label="Email requester when IT replies" />
            <Switch checked={s.email.notifyRequesterOnStatus} onChange={(v) => set('email', { notifyRequesterOnStatus: v })} label="Email requester when resolved or closed" />
            <Switch checked={s.email.notifyAgentOnAssign} onChange={(v) => set('email', { notifyAgentOnAssign: v })} label="Email agent when a ticket is assigned" />
            <Switch checked={s.email.notifyAgentOnRequesterReply} onChange={(v) => set('email', { notifyAgentOnRequesterReply: v })} label="Email assignee when requester replies" />
          </div>
          <Field label="Ignore emails whose subject starts with (one per line)" hint="Auto-replies are also detected from email headers.">
            <Textarea
              rows={4}
              className="font-mono text-xs"
              defaultValue={s.email.autoReplySubjectPrefixes.join('\n')}
              onBlur={(e) => set('email', { autoReplySubjectPrefixes: lines(e.target.value).map((l) => l.toLowerCase()) })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Email templates" description={`Placeholders: ${PLACEHOLDERS}`} />
        <CardContent className="space-y-4">
          {TEMPLATE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.rows === 1 ? (
                <Input value={s.templates[f.key]} onChange={(e) => set('templates', { [f.key]: e.target.value })} />
              ) : (
                <Textarea rows={5} value={s.templates[f.key]} onChange={(e) => set('templates', { [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="AI assistant (optional)" description="Summarises new tickets and suggests a priority. Ticket text is sent to the chosen provider, so leave this off if that is not allowed." />
        <CardContent className="space-y-4">
          <Switch checked={s.ai.enabled} onChange={(v) => set('ai', { enabled: v })} label="Enable AI summaries" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider">
              <Select value={s.ai.provider} onChange={(e) => set('ai', { provider: e.target.value as Settings['ai']['provider'] })}>
                <option value="openrouter">OpenRouter</option>
                <option value="groq">Groq</option>
              </Select>
            </Field>
            <Field label="Model" hint={s.ai.provider === 'groq' ? 'e.g. llama-3.1-8b-instant' : 'e.g. openai/gpt-4o-mini'}>
              <Input value={s.ai.model} onChange={(e) => set('ai', { model: e.target.value })} />
            </Field>
            <Field label="API key" hint={hasApiKey ? 'A key is saved. Leave blank to keep it.' : 'No key saved yet.'}>
              <div className="flex gap-2">
                <Input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasApiKey ? '••••••••' : 'Paste key'} />
                {hasApiKey && <Button variant="outline" onClick={() => submit(true)}>Remove</Button>}
              </div>
            </Field>
          </div>
          <Switch checked={s.ai.applySuggestedPriority} onChange={(v) => set('ai', { applySuggestedPriority: v })} label="Apply the suggested priority automatically (only if nobody has changed the ticket yet)" />
          {s.ai.enabled && !hasApiKey && !apiKey && <Alert variant="warn">AI is enabled but no API key is saved, so summaries will be skipped.</Alert>}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => submit()} loading={save.isPending}><Save className="h-4 w-4" /> Save changes</Button>
      </div>
    </div>
  )
}
