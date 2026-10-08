import { afterAll, describe, expect, it } from 'vitest'

// Needs DATABASE_URL and a migrated database. Run with `pnpm test:db`.
const { nextCounter } = await import('../src/services/ticketNumber')
const { prisma } = await import('../src/db')

describe('ticket number counter', () => {
  const key = `__test__|${Date.now()}`

  afterAll(async () => {
    await prisma.ticketIdCounter.deleteMany({ where: { periodKey: key } })
    await prisma.$disconnect()
  })

  it('hands out unique, gap-free values under concurrency', async () => {
    const values = await Promise.all(Array.from({ length: 25 }, () => nextCounter(key)))
    expect(new Set(values).size).toBe(25)
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
  })
})
