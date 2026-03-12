import { config } from '../config.js'
import { resetDatabase } from './migrate.js'

await resetDatabase(config.databaseUrl)
console.log('Done.')
