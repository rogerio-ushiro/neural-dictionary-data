/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // T4.7: cache the app-shell (JS/CSS/HTML) so a reload while offline still
    // shows the app — offline-first is core to the product (spec §40/§53).
    // Data (src/data/v04/packs/*) is NOT precached here: the loader (T4.4/T4.5)
    // owns fetching and caching graph/lexicon data in IndexedDB.
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico}'],
      },
      manifest: {
        name: 'Cognitive Dictionary',
        short_name: 'CogDict',
        start_url: '/',
        display: 'standalone',
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
