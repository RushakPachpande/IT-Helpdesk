export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}

function csrfToken(): string | undefined {
  return document.cookie.match(/(?:^|;\s*)hd_csrf=([^;]+)/)?.[1]
}

type Options = { method?: string; body?: unknown; form?: FormData }

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET')
  const headers: Record<string, string> = {}
  const token = csrfToken()
  if (token) headers['x-csrf-token'] = token
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await fetch(path, { method, headers, body, credentials: 'same-origin' })
  const text = await res.text()
  const data = text ? safeJson(text) : null
  if (!res.ok) {
    const err = data as { error?: string; code?: string } | null
    if (res.status === 403 && err?.code === 'PASSWORD_CHANGE_REQUIRED' && !location.pathname.startsWith('/change-password')) {
      location.assign('/change-password')
    }
    throw new ApiError(res.status, err?.error ?? `Request failed (${res.status})`, err?.code)
  }
  return data as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}
