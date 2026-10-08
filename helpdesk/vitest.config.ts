import { defineConfig } from 'vitest/config'

// Database tests (*.db.test.ts) need a running Postgres; they run via `pnpm test:db` (vitest.db.config.ts).
export default defineConfig({
  test: {
    include: ['**/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', '**/*.db.test.ts'],
    environment: 'node',
  },
})
