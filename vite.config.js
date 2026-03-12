import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['deck.gl', '@deck.gl/react', '@deck.gl/mapbox', '@deck.gl/layers', '@luma.gl/webgpu', '@luma.gl/core'],
    include: ['earcut'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
  },
})