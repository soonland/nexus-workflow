import { defineConfig } from 'prisma/config'
import { config } from 'dotenv'

config({ path: '.env' })

export default defineConfig({
  migrations: {
    seed: 'tsx ./prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL']!,
  },
})
