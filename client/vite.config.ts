import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const TABLE_SERVER = process.env.TABLE_SERVER ?? 'ws://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@velvet/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 5173),
    strictPort: false,
    // the Arena preview proxies this dev server under a *.e2b.app host
    allowedHosts: true,
    proxy: {
      '/ws': { target: TABLE_SERVER, ws: true, changeOrigin: true },
      '/healthz': { target: TABLE_SERVER.replace('ws://', 'http://').replace('wss://', 'https://'), changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    cssCodeSplit: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 900,
  },
});
