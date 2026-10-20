import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at /web/ alongside the legacy Flutter app at /app/ during migration.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/web/' : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'static',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5174,
  },
}));
