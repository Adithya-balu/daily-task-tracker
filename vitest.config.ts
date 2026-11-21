import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so tests don't load the dev-server API plugin.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'src/lib/**/*.test.ts'],
  },
})
