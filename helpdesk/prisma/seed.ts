import 'dotenv/config'
import argon2 from 'argon2'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

const CATEGORIES = ['Hardware', 'Software', 'Network / Internet', 'Email', 'Accounts & Access', 'Printer', 'Other']
const PRIORITIES = [
  { name: 'Low', rank: 1, color: '#64748b', isDefault: false },
  { name: 'Medium', rank: 2, color: '#2563eb', isDefault: true },
  { name: 'High', rank: 3, color: '#ea580c', isDefault: false },
  { name: 'Critical', rank: 4, color: '#dc2626', isDefault: false },
]

async function main() {
  if ((await prisma.category.count()) === 0) {
    await prisma.category.createMany({ data: CATEGORIES.map((name, i) => ({ name, sortOrder: i })) })
    console.log('Seeded categories')
  }
  if ((await prisma.priority.count()) === 0) {
    await prisma.priority.createMany({ data: PRIORITIES })
    console.log('Seeded priorities')
  }

  const domain = process.env.SEED_ALLOWED_DOMAIN?.trim().toLowerCase()
  if (domain && (await prisma.allowedDomain.count()) === 0) {
    await prisma.allowedDomain.create({ data: { domain, includeSubdomains: true } })
    console.log(`Seeded allowed domain ${domain}`)
  }

  const adminExists = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
  if (!adminExists) {
    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
    const password = process.env.SEED_ADMIN_PASSWORD
    if (!email || !password) {
      console.warn('No admin exists and SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are not set; skipping admin seed')
    } else {
      await prisma.user.create({
        data: {
          email,
          name: process.env.SEED_ADMIN_NAME?.trim() || 'IT Admin',
          role: 'ADMIN',
          status: 'ACTIVE',
          passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
          mustChangePassword: true,
        },
      })
      console.log(`Seeded admin ${email} (must change password at first login)`)
    }
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
