import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Older CSS targets keep max-width/max-height media queries (Safari before
    // 16.4 cannot parse range syntax like width<=640px, which the minifier
    // would otherwise emit) and keep the overflow: hidden fallback before
    // overflow: clip. Must match NARROW_QUERY in src/hooks/useMediaQuery.js.
    cssTarget: ['chrome87', 'edge88', 'firefox78', 'safari14'],
  },
  optimizeDeps: {
    exclude: ['@deck.gl/mapbox', '@deck.gl/layers', '@luma.gl/core'],
    include: ['earcut'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
  },
})