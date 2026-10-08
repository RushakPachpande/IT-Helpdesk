import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/test/**/*.db.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    fileParallelism: false,
  },
})
