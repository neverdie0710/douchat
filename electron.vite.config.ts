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
    resolve: { dedupe: ['react', 'react-dom'] },
    // Keep the React runtime and dialog dependencies in the initial optimizer
    // graph, rather than discovering new chunks when a dialog first opens.
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'fflate', 'streamdown', 'highlight.js/lib/common']
    },
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
