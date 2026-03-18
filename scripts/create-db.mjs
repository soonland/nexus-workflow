#!/usr/bin/env node
// Creates a database if it doesn't already exist.
// Usage: node scripts/create-db.mjs <DATABASE_URL>
import postgres from 'postgres'

const url = process.argv[2]
if (!url) { console.error('Usage: create-db.mjs <DATABASE_URL>'); process.exit(1) }

const dbName = new URL(url).pathname.slice(1)
const adminUrl = url.replace(/\/[^/]+$/, '/postgres')

const sql = postgres(adminUrl, { max: 1, onnotice: () => {} })
try {
  const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${dbName}`
  if (rows.length > 0) {
    console.log(`Database '${dbName}' already exists`)
  } else {
    await sql.unsafe(`CREATE DATABASE "${dbName}"`)
    console.log(`Created database '${dbName}'`)
  }
} finally {
  await sql.end()
}
