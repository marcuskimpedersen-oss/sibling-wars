import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: { '@': '/src' }
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0
  },
  server: {
    proxy: {
      '/colyseus': {
        target: 'http://localhost:2567',
        ws: true,
        rewrite: (path) => path.replace(/^\/colyseus/, '')
      }
    }
  }
})
