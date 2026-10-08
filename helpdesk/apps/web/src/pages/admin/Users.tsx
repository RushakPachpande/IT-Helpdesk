import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Plus, Search, UserCheck, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { ROLE_LABELS, ROLES, type Role } from '@helpdesk/shared'
import { api, errorMessage } from '@/lib/api'
import { useMe } from '@/lib/auth'
import type { AdminUser } from '@/lib/types'
import { formatDateTime } from '@/lib/utils'
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, PageLoader, Select, Table, Td, Th } from '@/components/ui'

const STATUS_STYLE = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  INACTIVE: 'bg-slate-200 text-slate-700',
  PLACEHOLDER: 'bg-amber-100 text-amber-800',
}
const STATUS_LABEL = { ACTIVE: 'Active', INACTIVE: 'Inactive', PLACEHOLDER: 'From email (no login)' }

function TempPasswordDialog({ value, email, onClose }: { value: { password: string; email: string } | null; email?: string; onClose: () => void }) {
  return (
    <Dialog open={!!value} onClose={onClose} title="Temporary password" footer={<Button onClick={onClose}>Done</Button>}>
      <p className="text-sm text-slate-600">
        Share this with <strong>{value?.email ?? email}</strong>. It is shown only once; they must change it at first sign-in.
      </p>
      <div className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
        <code className="flex-1 font-mono text-base tracking-wide">{value?.password}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(value?.password ?? '')
            toast.success('Copied')
          }}
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
      </div>
    </Dialog>
  )
}

function CreateUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (pw: string, email: string) => void }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'EMPLOYEE' as Role, department: '', temporaryPassword: '' })
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: () =>
      api<{ user: AdminUser; temporaryPassword: string }>('/api/admin/users', {
        body: {
          email: form.email,
          name: form.name,
          role: form.role,
          department: form.department || null,
          temporaryPassword: form.temporaryPassword || undefined,
        },
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] })
      onCreated(res.temporaryPassword, res.user.email)
      setForm({ email: '', name: '', role: 'EMPLOYEE', department: '', temporaryPassword: '' })
      onClose()
    },
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create user"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} onClick={() => create.mutate()} disabled={!form.email || !form.name}>Create user</Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.error && <Alert variant="error">{errorMessage(create.error)}</Alert>}
        <Field label="Company email" hint="Must belong to an allowed domain">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" />
        </Field>
        <Field label="Full name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Department (optional)">
            <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </Field>
        </div>
        <Field label="Temporary password (optional)" hint="Leave empty to generate a strong one">
          <Input value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  )
}

export function UsersPage() {
  const me = useMe()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [creating, setCreating] = useState(false)
  const [tempPw, setTempPw] = useState<{ password: string; email: string } | null>(null)

  const users = useQuery({
    queryKey: ['admin-users', q, status],
    queryFn: () => api<{ users: AdminUser[] }>(`/api/admin/users?${new URLSearchParams({ q, status })}`),
  })

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api(`/api/admin/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('User updated')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const reset = useMutation({
    mutationFn: (u: AdminUser) => api<{ temporaryPassword: string; user: AdminUser }>(`/api/admin/users/${u.id}/reset-password`, { body: {} }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] })
      setTempPw({ password: res.temporaryPassword, email: res.user.email })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div>
      <PageHeader
        title="Users"
        description="Create accounts for employees and the IT team. People who email IT without an account appear here as placeholders."
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Create user</Button>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="PLACEHOLDER">From email (no login)</option>
          </Select>
        </div>
        {users.isLoading ? (
          <PageLoader />
        ) : !users.data?.users.length ? (
          <EmptyState title="No users found" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Last sign-in</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {users.data.users.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-slate-500">{u.email}{u.department ? ` · ${u.department}` : ''}</p>
                  </Td>
                  <Td>
                    <Select
                      className="h-8 w-32 text-xs"
                      value={u.role}
                      disabled={u.id === me.id}
                      onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value } })}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Badge className={STATUS_STYLE[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                    {u.mustChangePassword && u.status === 'ACTIVE' && <p className="mt-1 text-xs text-slate-500">Temporary password</p>}
                    {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <p className="mt-1 text-xs text-red-600">Locked</p>}
                  </Td>
                  <Td className="text-xs text-slate-500">{formatDateTime(u.lastLoginAt)}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => reset.mutate(u)} title="Generate a new temporary password">
                        <KeyRound className="h-3.5 w-3.5" /> {u.status === 'PLACEHOLDER' ? 'Activate' : 'Reset password'}
                      </Button>
                      {u.status === 'ACTIVE' && u.id !== me.id && (
                        <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: u.id, body: { status: 'INACTIVE' } })} title="Deactivate">
                          <UserX className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {u.status === 'INACTIVE' && (
                        <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: u.id, body: { status: 'ACTIVE' } })} title="Reactivate">
                          <UserCheck className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onCreated={(password, email) => setTempPw({ password, email })} />
      <TempPasswordDialog value={tempPw} onClose={() => setTempPw(null)} />
    </div>
  )
}
