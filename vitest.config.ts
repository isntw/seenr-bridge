import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // better-sqlite3 handles are process-global; parallel files fight over
    // the same DATA_DIR. One fork at a time keeps DB tests deterministic.
    poolOptions: { forks: { singleFork: true } },
  },
})
