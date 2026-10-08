export interface DomainRule {
  domain: string
  includeSubdomains: boolean
}

export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '')
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : normalizeDomain(email.slice(at + 1))
}

export function isValidDomain(domain: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
}

/** True if the email's domain equals an allowed domain, or is a subdomain of one that allows subdomains. */
export function isEmailDomainAllowed(email: string, rules: DomainRule[]): boolean {
  const d = emailDomain(email)
  if (!d) return false
  return rules.some((r) => {
    const rule = normalizeDomain(r.domain)
    if (d === rule) return true
    return r.includeSubdomains && d.endsWith(`.${rule}`)
  })
}
