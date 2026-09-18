import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    // Keep clear of Termany's release PTY port (5174) and Vite's 5173 fallback chain.
    server: {
      port: 5275,
      strictPort: true
    },
    preview: {
      port: 5274,
      strictPort: true
    }
  }
})
