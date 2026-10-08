import { describe, expect, it } from 'vitest'
import { parseAiReply } from '../src/services/aiReply'

describe('parseAiReply', () => {
  it('reads plain JSON', () => {
    expect(parseAiReply('{"summary":"Outlook crashes on start","priority":"high"}')).toEqual({ summary: 'Outlook crashes on start', priority: 'High' })
  })

  it('tolerates code fences and prose around the JSON', () => {
    const reply = 'Sure!\n```json\n{"summary": "VPN drops", "priority": "Medium"}\n```'
    expect(parseAiReply(reply)).toEqual({ summary: 'VPN drops', priority: 'Medium' })
  })

  it('drops unknown priorities but keeps the summary', () => {
    expect(parseAiReply('{"summary":"x","priority":"P1"}')).toEqual({ summary: 'x', priority: null })
  })

  it('returns null for invalid or empty replies', () => {
    expect(parseAiReply('no json here')).toBeNull()
    expect(parseAiReply('{"summary": ""}')).toBeNull()
    expect(parseAiReply('{broken')).toBeNull()
  })
})
