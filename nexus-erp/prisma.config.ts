import { defineConfig } from 'prisma/config'
import { config } from 'dotenv'
import path from 'node:path'

config({ path: path.resolve(__dirname, '.env') })

export default defineConfig({
  migrations: {
    seed: 'tsx ./prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL']!,
  },
})
