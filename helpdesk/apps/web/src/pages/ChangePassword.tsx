import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, KeyRound } from 'lucide-react'
import { passwordProblems, PASSWORD_MIN_LENGTH } from '@helpdesk/shared'
import { api, errorMessage } from '@/lib/api'
import { homePath, meQuery } from '@/lib/auth'
import type { Me } from '@/lib/types'
import { Alert, Button, Card, Field, Input } from '@/components/ui'
import { cn } from '@/lib/utils'

const RULES = [`At least ${PASSWORD_MIN_LENGTH} characters`, 'A lowercase letter', 'An uppercase letter', 'A digit']

export function ChangePasswordPage() {
  const { data: me } = useQuery(meQuery)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const problems = passwordProblems(next)
  const forced = me?.mustChangePassword

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (next !== confirm) return setError('The new passwords do not match')
    if (problems.length) return setError(`Password needs: ${problems.join(', ')}`)
    setLoading(true)
    try {
      await api('/api/auth/change-password', { body: { currentPassword: current, newPassword: next } })
      const updated = (await qc.fetchQuery({ ...meQuery, staleTime: 0 })) as Me
      await navigate({ to: homePath(updated) })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-linear-to-br from-slate-100 to-blue-50 p-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600">
            <KeyRound className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold">{forced ? 'Set your password' : 'Change password'}</h1>
          {forced && <p className="mt-1 text-sm text-slate-500">Replace the temporary password IT gave you before continuing.</p>}
        </div>
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <Field label={forced ? 'Temporary password' : 'Current password'}>
            <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password">
            <Input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <ul className="space-y-1 text-xs">
            {RULES.map((r) => {
              const ok = next.length > 0 && !problems.includes(r)
              return (
                <li key={r} className={cn('flex items-center gap-1.5', ok ? 'text-emerald-600' : 'text-slate-500')}>
                  <Check className={cn('h-3.5 w-3.5', !ok && 'opacity-30')} /> {r}
                </li>
              )
            })}
          </ul>
          <Field label="Confirm new password">
            <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>Save password</Button>
          {!forced && me && (
            <Link to={homePath(me)} className="block text-center text-sm text-slate-500 hover:text-slate-800">Cancel</Link>
          )}
        </form>
      </Card>
    </div>
  )
}
