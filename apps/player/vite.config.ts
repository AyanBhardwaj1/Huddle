/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const ENGINE_PATHS = ['/ws', '/parties', '/games', '/faucet', '/audio', '/agent', '/health'];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_ENGINE_URL || 'http://localhost:8080';
  const proxy = Object.fromEntries(
    ENGINE_PATHS.map((p) => [p, { target, changeOrigin: true, ws: p === '/ws' }]),
  );

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Huddle',
          short_name: 'Huddle',
          description: 'Call every moment of the game with your friends.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#08090B',
          theme_color: '#08090B',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
          navigateFallback: '/index.html',
          // Never let the service worker answer engine routes or the box UI.
          navigateFallbackDenylist: [/^\/(ws|parties|games|faucet|audio|agent|health|box|pay)(\/|$)/],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        },
      }),
    ],
    server: { port: 5173, strictPort: true, host: true, proxy },
    preview: { port: 5173, proxy },
    build: { target: 'es2020', chunkSizeWarningLimit: 900 },
    test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
  };
});
