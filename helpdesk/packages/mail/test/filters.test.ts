import { describe, expect, it } from 'vitest'
import { detectPriority, isAutoReply, isSelfSent, senderDisplayName } from '../src/filters'
import { baseSubject, buildReferences, parseMessageIds } from '../src/threading'

const PREFIXES = ['automatic reply:', 'out of office', 'undeliverable:']

describe('detectPriority', () => {
  it('flags urgent wording as High', () => {
    expect(detectPriority('Email not working', '')).toBe('High')
    expect(detectPriority('Help', 'the server is down for everyone')).toBe('High')
  })

  it('flags relaxed wording as Low', () => {
    expect(detectPriority('Quick question', 'no rush')).toBe('Low')
  })

  it('defaults to Medium and matches whole words only', () => {
    expect(detectPriority('Download speed', 'my downloads are slow')).toBe('Medium')
  })
})

describe('isAutoReply', () => {
  it('matches configured subject prefixes', () => {
    expect(isAutoReply('Automatic reply: Away', {}, PREFIXES)).toBe(true)
    expect(isAutoReply('Laptop issue', {}, PREFIXES)).toBe(false)
  })

  it('honours auto-submitted, precedence and report headers', () => {
    expect(isAutoReply('Hi', { 'auto-submitted': 'auto-replied' }, PREFIXES)).toBe(true)
    expect(isAutoReply('Hi', { 'auto-submitted': 'no' }, PREFIXES)).toBe(false)
    expect(isAutoReply('Hi', { precedence: 'bulk' }, PREFIXES)).toBe(true)
    expect(isAutoReply('Hi', { 'content-type': 'multipart/report; report-type=delivery-status' }, PREFIXES)).toBe(true)
  })
})

describe('sender helpers', () => {
  it('detects mail sent by the mailbox itself', () => {
    expect(isSelfSent('IT@Example.com ', 'it@example.com')).toBe(true)
  })

  it('derives a display name from the address when missing', () => {
    expect(senderDisplayName('', 'jane.doe@example.com')).toBe('Jane Doe')
    expect(senderDisplayName('Jane D.', 'jane.doe@example.com')).toBe('Jane D.')
  })
})

describe('threading', () => {
  it('parses message ids from headers', () => {
    expect(parseMessageIds('<a@x> <b@y>\r\n <c@z>')).toEqual(['<a@x>', '<b@y>', '<c@z>'])
    expect(parseMessageIds(undefined)).toEqual([])
  })

  it('appends the replied-to id once', () => {
    expect(buildReferences(['<a@x>'], '<b@y>')).toEqual(['<a@x>', '<b@y>'])
    expect(buildReferences(['<a@x>', '<b@y>'], '<b@y>')).toEqual(['<a@x>', '<b@y>'])
  })

  it('caps long reference chains, keeping the first id', () => {
    const refs = Array.from({ length: 30 }, (_, i) => `<${i}@x>`)
    const out = buildReferences(refs, '<new@x>')
    expect(out).toHaveLength(20)
    expect(out[0]).toBe('<0@x>')
    expect(out.at(-1)).toBe('<new@x>')
  })

  it('strips nested reply prefixes', () => {
    expect(baseSubject('RE: Fwd: re:  Printer')).toBe('Printer')
  })
})
