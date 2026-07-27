import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fetchYahooPrices, parseSymbols } from './api/_yahoo.js'

// In sviluppo Vite non esegue le funzioni serverless di Vercel: questo plugin
// serve /api/prices localmente con la stessa logica, così si può testare anche
// senza deploy.
function devPricesApi() {
  return {
    name: 'dev-prices-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/prices', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        try {
          const url = new URL(req.originalUrl || req.url, 'http://localhost')
          const symbols = parseSymbols(url.searchParams.get('symbols') || url.searchParams.get('symbol'))
          if (!symbols.length) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Nessun simbolo' })); return }
          const results = await fetchYahooPrices(symbols)
          res.end(JSON.stringify({ results }))
        } catch (e) {
          res.statusCode = 502; res.end(JSON.stringify({ error: 'Errore recupero prezzi' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    devPricesApi(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Analisi spese',
        short_name: 'Analisi spese',
        description: 'Dashboard personale di spese e patrimonio',
        theme_color: '#0D1017',
        background_color: '#0D1017',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
})
