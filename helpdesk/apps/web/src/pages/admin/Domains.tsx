import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import { Alert, Button, Card, CardContent, CardHeader, EmptyState, Input, PageHeader, PageLoader, Switch, Table, Td, Th } from '@/components/ui'

interface Domain {
  id: string
  domain: string
  includeSubdomains: boolean
  createdAt: string
}

export function DomainsPage() {
  const qc = useQueryClient()
  const [domain, setDomain] = useState('')
  const [includeSubdomains, setIncludeSubdomains] = useState(true)
  const list = useQuery({ queryKey: ['domains'], queryFn: () => api<{ domains: Domain[] }>('/api/admin/domains') })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['domains'] })

  const add = useMutation({
    mutationFn: () => api('/api/admin/domains', { body: { domain, includeSubdomains } }),
    onSuccess: () => {
      setDomain('')
      void invalidate()
      toast.success('Domain added')
    },
  })
  const toggle = useMutation({
    mutationFn: (d: Domain) => api(`/api/admin/domains/${d.id}`, { method: 'PATCH', body: { includeSubdomains: !d.includeSubdomains } }),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (d: Domain) => api(`/api/admin/domains/${d.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void invalidate()
      toast.success('Domain removed')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div>
      <PageHeader
        title="Allowed domains"
        description="Only emails on these domains can get accounts. Emails to the support mailbox from other domains go to Needs Review."
      />
      <Card className="mb-6">
        <CardHeader title="Add domain" />
        <CardContent>
          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              add.mutate()
            }}
          >
            <Input className="max-w-xs" placeholder="company.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <Switch checked={includeSubdomains} onChange={setIncludeSubdomains} label="Include subdomains (e.g. it.company.com)" />
            <Button type="submit" loading={add.isPending} disabled={!domain.trim()}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </form>
          {add.error && <Alert variant="error" className="mt-3">{errorMessage(add.error)}</Alert>}
        </CardContent>
      </Card>
      <Card>
        {list.isLoading ? (
          <PageLoader />
        ) : !list.data?.domains.length ? (
          <EmptyState icon={<Globe className="h-10 w-10" />} title="No allowed domains" description="Add your company domain so you can create user accounts." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Domain</Th>
                <Th>Subdomains</Th>
                <Th>Added</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.data.domains.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium">{d.domain}</Td>
                  <Td>
                    <Switch checked={d.includeSubdomains} onChange={() => toggle.mutate(d)} label={d.includeSubdomains ? `*.${d.domain} allowed` : 'Exact domain only'} />
                  </Td>
                  <Td className="text-xs text-slate-500">{formatDateTime(d.createdAt)}</Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => confirm(`Remove ${d.domain}? Existing users keep their accounts.`) && remove.mutate(d)}
                      aria-label={`Remove ${d.domain}`}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
