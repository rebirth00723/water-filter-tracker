import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.DATABASE_PATH ?? './data/app.sqlite3' },
  // strict 會在產生 migration 時要求互動確認，CI 與腳本化流程下會卡住
  strict: false,
  verbose: true,
})
