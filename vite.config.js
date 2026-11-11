import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import atasSync from './atas-sync.js'
import aiProxy from './ai-proxy.js'
import localApi from './local-api.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localApi(), atasSync(), aiProxy()],
  // Fixed port so the ATAS add-on always knows where to send trades.
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/atas-addon/**', '**/data/**', '**/logs/**'] } },
  preview: { port: 5173, strictPort: true },
})
