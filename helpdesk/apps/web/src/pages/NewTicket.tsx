import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import { metaQuery } from '@/lib/auth'
import type { TicketSummary } from '@/lib/types'
import { Alert, Button, Card, CardContent, Field, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui'
import { FilePicker, filesValid } from '@/components/FilePicker'

const schema = z.object({
  subject: z.string().trim().min(3, 'At least 3 characters').max(200),
  categoryId: z.string().min(1, 'Choose a type'),
  priorityId: z.string().min(1, 'Choose a priority'),
  description: z.string().trim().min(5, 'Describe the problem').max(10000),
})
type FormValues = z.infer<typeof schema>

export function NewTicketPage() {
  const meta = useQuery(metaQuery)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { subject: '', categoryId: '', priorityId: '', description: '' } })

  useEffect(() => {
    const def = meta.data?.priorities.find((p) => p.isDefault && p.active)
    if (def && !form.getValues('priorityId')) form.setValue('priorityId', def.id)
  }, [meta.data, form])

  const create = useMutation({
    mutationFn: (values: FormValues) => {
      const fd = new FormData()
      Object.entries(values).forEach(([k, v]) => fd.set(k, v))
      files.forEach((f) => fd.append('files', f, f.name))
      return api<{ ticket: TicketSummary }>('/api/tickets', { form: fd })
    },
    onSuccess: async ({ ticket }) => {
      toast.success(`Request ${ticket.ticketNumber} created`)
      await qc.invalidateQueries({ queryKey: ['tickets'] })
      await navigate({ to: '/tickets/$ticketId', params: { ticketId: ticket.id } })
    },
  })

  if (meta.isLoading || !meta.data) return <PageLoader />
  const { errors } = form.formState
  const priorities = meta.data.priorities.filter((p) => p.active)

  return (
    <div className="max-w-3xl">
      <PageHeader title="New support request" description="Tell IT what is wrong. Screenshots help us fix things faster." />
      <Card>
        <CardContent className="py-6">
          <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-5">
            {create.error && <Alert variant="error">{errorMessage(create.error)}</Alert>}
            <Field label="Subject" error={errors.subject?.message}>
              <Input placeholder="e.g. Outlook keeps asking for my password" {...form.register('subject')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type of issue" error={errors.categoryId?.message}>
                <Select {...form.register('categoryId')}>
                  <option value="">Select...</option>
                  {meta.data.categories.filter((c) => c.active).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority" error={errors.priorityId?.message} hint="High: you cannot work. Critical: many people affected.">
                <Select {...form.register('priorityId')}>
                  <option value="">Select...</option>
                  {priorities.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Description" error={errors.description?.message}>
              <Textarea
                rows={7}
                placeholder="What happened, when did it start, any error messages, which device or application..."
                {...form.register('description')}
              />
            </Field>
            <Field label="Attachments">
              <FilePicker files={files} onChange={setFiles} limits={meta.data.attachments} />
            </Field>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-5">
              <Button type="button" variant="outline" onClick={() => navigate({ to: '/tickets' })}>Cancel</Button>
              <Button type="submit" loading={create.isPending} disabled={!filesValid(files, meta.data.attachments)}>Submit request</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
