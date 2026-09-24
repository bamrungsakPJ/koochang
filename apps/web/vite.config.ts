import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Use the shared package's TS source directly (its dist is CommonJS for the API).
    alias: {
      '@serviceflow/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Same origin as the API so the refresh cookie (path /api/v1/auth) just works.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
