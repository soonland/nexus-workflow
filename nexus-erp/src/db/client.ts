import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

declare global {

  var __prisma: PrismaClient | undefined
}

function createClient() {
  const connectionString = process.env['DATABASE_URL'] ?? ''
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

export const db = globalThis.__prisma ?? createClient()
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = db
