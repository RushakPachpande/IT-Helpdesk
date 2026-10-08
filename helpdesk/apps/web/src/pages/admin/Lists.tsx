import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Star } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import { metaQuery } from '@/lib/auth'
import type { Category, Priority } from '@/lib/types'
import { Badge, Button, Card, CardContent, CardHeader, Input, PageHeader, PageLoader, Switch, Table, Td, Th } from '@/components/ui'

function useListMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: 'POST' | 'PATCH'; body: unknown }) => api(path, { method, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: metaQuery.queryKey }),
    onError: (e) => toast.error(errorMessage(e)),
  })
}

function Categories({ items }: { items: Category[] }) {
  const m = useListMutation()
  const [name, setName] = useState('')
  const add = () =>
    m.mutate(
      { path: '/api/admin/categories', method: 'POST', body: { name, sortOrder: (items.at(-1)?.sortOrder ?? 0) + 10 } },
      { onSuccess: () => setName('') },
    )
  return (
    <Card>
      <CardHeader title="Request types" description="Shown to employees when they raise a request. Deactivate instead of deleting so old tickets keep their type." />
      <Table>
        <thead>
          <tr><Th>Name</Th><Th className="w-28">Order</Th><Th className="w-28">Active</Th></tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id}>
              <Td>
                <Input
                  defaultValue={c.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && m.mutate({ path: `/api/admin/categories/${c.id}`, method: 'PATCH', body: { name: e.target.value } })}
                />
              </Td>
              <Td>
                <Input
                  type="number"
                  defaultValue={c.sortOrder}
                  onBlur={(e) => Number(e.target.value) !== c.sortOrder && m.mutate({ path: `/api/admin/categories/${c.id}`, method: 'PATCH', body: { sortOrder: Number(e.target.value) } })}
                />
              </Td>
              <Td>
                <Switch checked={c.active} onChange={(active) => m.mutate({ path: `/api/admin/categories/${c.id}`, method: 'PATCH', body: { active } })} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <CardContent className="flex gap-2">
        <Input placeholder="New type, e.g. VPN" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && add()} />
        <Button onClick={add} disabled={!name.trim()} loading={m.isPending}><Plus className="h-4 w-4" /> Add</Button>
      </CardContent>
    </Card>
  )
}

function Priorities({ items }: { items: Priority[] }) {
  const m = useListMutation()
  const [name, setName] = useState('')
  const add = () =>
    m.mutate(
      { path: '/api/admin/priorities', method: 'POST', body: { name, rank: (items.at(-1)?.rank ?? 0) + 1 } },
      { onSuccess: () => setName('') },
    )
  const patch = (id: string, body: Partial<Priority>) => m.mutate({ path: `/api/admin/priorities/${id}`, method: 'PATCH', body })
  return (
    <Card>
      <CardHeader title="Priorities" description="Rank orders them from lowest to highest. Email keyword detection maps to Low, Medium, High and Critical by name." />
      <Table>
        <thead>
          <tr><Th>Name</Th><Th className="w-24">Rank</Th><Th className="w-24">Colour</Th><Th className="w-28">Default</Th><Th className="w-24">Active</Th></tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <Td>
                <Input defaultValue={p.name} onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && patch(p.id, { name: e.target.value })} />
              </Td>
              <Td>
                <Input type="number" defaultValue={p.rank} onBlur={(e) => Number(e.target.value) !== p.rank && patch(p.id, { rank: Number(e.target.value) })} />
              </Td>
              <Td>
                <input
                  type="color"
                  defaultValue={p.color}
                  className="h-9 w-14 cursor-pointer rounded border border-slate-300"
                  onBlur={(e) => e.target.value !== p.color && patch(p.id, { color: e.target.value })}
                  aria-label={`${p.name} colour`}
                />
              </Td>
              <Td>
                {p.isDefault ? (
                  <Badge className="bg-blue-100 text-blue-800"><Star className="h-3 w-3" /> Default</Badge>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => patch(p.id, { isDefault: true })}>Make default</Button>
                )}
              </Td>
              <Td>
                <Switch checked={p.active} disabled={p.isDefault} onChange={(active) => patch(p.id, { active })} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <CardContent className="flex gap-2">
        <Input placeholder="New priority" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && add()} />
        <Button onClick={add} disabled={!name.trim()} loading={m.isPending}><Plus className="h-4 w-4" /> Add</Button>
      </CardContent>
    </Card>
  )
}

export function ListsPage() {
  const meta = useQuery(metaQuery)
  if (meta.isLoading || !meta.data) return <PageLoader />
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Types & priorities" description="Changes are saved when you leave a field." />
      <Categories items={meta.data.categories} />
      <Priorities items={meta.data.priorities} />
    </div>
  )
}
