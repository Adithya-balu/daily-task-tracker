import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { dailyFocusApi } from './server/plugin'

export default defineConfig({
  plugins: [react(), tailwindcss(), dailyFocusApi()],
  server: {
    // Claude writes into data/runs while tasks run; don't trigger reloads.
    watch: { ignored: ['**/data/**'] },
  },
})
