/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'

// Test config lives here (not in vite.config.ts) — vite.config.ts is now a
// library build, and the app repo it was copied from kept `test` inline.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
