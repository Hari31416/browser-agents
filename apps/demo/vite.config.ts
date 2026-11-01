import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { browserAliases, browserUtilities } from '@browser-agents/runtime/vite'

export default defineConfig({
  plugins: [react(), browserUtilities()],
  resolve: {
    alias: browserAliases,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
    plugins: () => [browserUtilities()],
  },
})
