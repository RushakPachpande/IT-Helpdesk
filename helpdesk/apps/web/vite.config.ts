import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const API = process.env.VITE_API_PROXY ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
})
