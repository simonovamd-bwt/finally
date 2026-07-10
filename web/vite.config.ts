import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api (REST + SSE) to the backend so the frontend and
// backend share an origin in development, matching production where the backend
// serves the built SPA directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
