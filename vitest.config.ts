import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // better-sqlite3 handles are process-global; parallel files fight over
    // the same DATA_DIR. Disabling file parallelism keeps DB tests
    // deterministic. NOTE: `poolOptions.forks.singleFork` was the Vitest
    // 2/3 spelling and was removed in Vitest 4 (silently ignored, not an
    // error) — `fileParallelism` is the current top-level replacement.
    // Do not reintroduce `poolOptions` for this purpose.
    fileParallelism: false,
  },
})
