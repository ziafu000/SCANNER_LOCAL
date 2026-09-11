import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
const base = process.env.VITE_BASE_PATH || '/'
export default defineConfig({
  base,
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icon.svg'],
    manifest: {
      name: 'SCANNER',
      short_name: 'SCANNER',
      description: 'Máy quét tài liệu gia đình - đơn giản, nhanh, nét',
      theme_color: '#0b132b',
      background_color: '#0b132b',
      display: 'standalone',
      scope: base,
      start_url: base,
      icons: [
        { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      runtimeCaching: [
        { urlPattern: /^https:\/\/docs\.opencv\.org\/.*/i, handler: 'CacheFirst', options: { cacheName: 'opencv-cache', expiration: { maxEntries: 5, maxAgeSeconds: 60*60*24*30 } } }
      ]
    }
  })],
  server: { 
    host: true,
    allowedHosts: true
  }
})
