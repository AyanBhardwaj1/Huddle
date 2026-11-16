import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// Served by the engine at /box/ in production (DECISIONS D16). In dev, Vite on :5174 proxies the
// engine's HTTP + WebSocket routes so the app uses same-origin URLs everywhere.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const engine = env.VITE_ENGINE_URL || 'http://localhost:8080';
  const http = { target: engine, changeOrigin: true };
  return {
    base: '/box/',
    plugins: [react()],
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        '/ws': { target: engine.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
        '/parties': http,
        '/games': http,
        '/replays': http,
        '/audio': http,
        '/agent': http,
        '/health': http,
      },
    },
    build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  };
});
