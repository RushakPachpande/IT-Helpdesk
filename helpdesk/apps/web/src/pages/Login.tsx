import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { LifeBuoy } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { homePath, meQuery } from '@/lib/auth'
import type { Me } from '@/lib/types'
import { Alert, Button, Card, Field, Input } from '@/components/ui'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api('/api/auth/login', { body: { email, password } })
      qc.removeQueries()
      const me = (await qc.fetchQuery(meQuery)) as Me
      await navigate({ to: me.mustChangePassword ? '/change-password' : homePath(me) })
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
            <LifeBuoy className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold">IT Helpdesk</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in with your company email</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <Field label="Email">
            <Input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>Sign in</Button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-500">Accounts are created by IT. Contact IT if you need access or forgot your password.</p>
      </Card>
    </div>
  )
}
