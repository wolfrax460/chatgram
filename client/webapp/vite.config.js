import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://chatgram-xi.vercel.app/web/ alongside the Flutter app at
// /app/, so every asset URL is prefixed with /web/.
export default defineConfig({
  plugins: [react()],
  base: '/web/',
  build: {
    outDir: 'dist',
    assetsDir: 'static',
    emptyOutDir: true,
    sourcemap: false,
  },
});
