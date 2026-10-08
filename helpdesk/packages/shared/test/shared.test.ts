import { describe, expect, it } from 'vitest'
import {
  datePartsInZone,
  formatTicketNumber,
  isEmailDomainAllowed,
  isValidDomain,
  mergeSettings,
  normalizeDomain,
  passwordProblems,
  renderTemplate,
  settingsSchema,
  DEFAULT_SETTINGS,
  ticketNumberRegex,
  ticketPeriodKey,
} from '../src'

const FORMAT = '{PREFIX}-{YYYY}{MM}{DD}-{SEQ:4}'

describe('ticket numbers', () => {
  const parts = datePartsInZone(new Date('2026-10-08T20:00:00Z'), 'Asia/Kolkata')

  it('uses the configured time zone for the date part', () => {
    // 20:00 UTC is already 9 October in India.
    expect(parts).toEqual({ YYYY: '2026', YY: '26', MM: '10', DD: '09' })
  })

  it('formats with zero-padded sequence', () => {
    expect(formatTicketNumber(FORMAT, 'NGI', parts, 7)).toBe('NGI-20261009-0007')
    expect(formatTicketNumber('{PREFIX}{SEQ}', 'HD', parts, 12345)).toBe('HD12345')
  })

  it('resets the counter per the finest date token', () => {
    expect(ticketPeriodKey(FORMAT, parts)).toBe('D:20261009')
    expect(ticketPeriodKey('{PREFIX}-{YYYY}{MM}-{SEQ}', parts)).toBe('M:202610')
    expect(ticketPeriodKey('{PREFIX}-{YY}-{SEQ}', parts)).toBe('Y:2026')
    expect(ticketPeriodKey('{PREFIX}-{SEQ:6}', parts)).toBe('ALL')
  })

  it('finds the ticket number in an email subject', () => {
    const re = ticketNumberRegex(FORMAT, 'NGI')
    expect(re.exec('RE: [NGI-20261009-0007] Laptop')?.[1]).toBe('NGI-20261009-0007')
    expect(re.exec('RE: [ngi-20261009-0007] Laptop')?.[1]).toBe('ngi-20261009-0007')
    expect(re.exec('NGI-20261009-0007 without brackets')).toBeNull()
    expect(re.exec('[ABC-20261009-0007]')).toBeNull()
  })
})

describe('allowed domains', () => {
  const rules = [
    { domain: 'example.com', includeSubdomains: true },
    { domain: 'partner.org', includeSubdomains: false },
  ]

  it('allows exact domains and subdomains when enabled', () => {
    expect(isEmailDomainAllowed('a@example.com', rules)).toBe(true)
    expect(isEmailDomainAllowed('a@it.example.com', rules)).toBe(true)
    expect(isEmailDomainAllowed('a@partner.org', rules)).toBe(true)
    expect(isEmailDomainAllowed('a@eu.partner.org', rules)).toBe(false)
  })

  it('rejects look-alike domains', () => {
    expect(isEmailDomainAllowed('a@badexample.com', rules)).toBe(false)
    expect(isEmailDomainAllowed('a@example.com.evil.net', rules)).toBe(false)
    expect(isEmailDomainAllowed('not-an-email', rules)).toBe(false)
  })

  it('normalizes and validates domain input', () => {
    expect(normalizeDomain(' @Example.COM. ')).toBe('example.com')
    expect(isValidDomain('it.example.co.uk')).toBe(true)
    expect(isValidDomain('localhost')).toBe(false)
    expect(isValidDomain('-bad.com')).toBe(false)
  })
})

describe('settings', () => {
  it('fills new keys from defaults when stored settings are older', () => {
    const merged = mergeSettings({ ticketId: { prefix: 'IT' } })
    expect(merged.ticketId).toEqual({ prefix: 'IT', format: DEFAULT_SETTINGS.ticketId.format })
    expect(merged.email.reopenWindowDays).toBe(DEFAULT_SETTINGS.email.reopenWindowDays)
  })

  it('requires {SEQ} in the ticket format', () => {
    const bad = { ...DEFAULT_SETTINGS, ticketId: { prefix: 'IT', format: '{PREFIX}-{YYYY}' } }
    expect(settingsSchema.safeParse(bad).success).toBe(false)
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true)
  })

  it('renders templates and leaves unknown placeholders', () => {
    expect(renderTemplate('Hi {name}, ticket {num} {unknown}', { name: 'Jane', num: 5 })).toBe('Hi Jane, ticket 5 {unknown}')
  })
})

describe('passwords', () => {
  it('lists missing rules', () => {
    expect(passwordProblems('short')).toEqual(expect.arrayContaining(['An uppercase letter', 'A digit']))
    expect(passwordProblems('LongEnough123')).toEqual([])
  })
})
