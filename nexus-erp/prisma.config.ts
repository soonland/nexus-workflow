import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { config } from 'dotenv'

config({ path: path.resolve(__dirname, '.env') })

export default defineConfig({
  migrations: {
    seed: 'tsx ./prisma/seed.ts',
  },
  datasource: {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    url: process.env['DATABASE_URL']!,
  },
})
