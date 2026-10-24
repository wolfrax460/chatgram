import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at /web/ alongside the legacy Flutter app at /app/ during migration.
export default defineConfig(({ mode }) => {
  // In development the API runs on another port. Uploaded media is stored as a
  // server-relative `/uploads/...` URL when Cloudinary is not configured, so the
  // dev server proxies that path to the API. In production the web app and the
  // API share an origin and no proxy is involved.
  const apiUrl = (process.env.VITE_API_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');

  return {
    plugins: [react()],
    base: mode === 'production' ? '/web/' : '/',
    build: {
      outDir: 'dist',
      assetsDir: 'static',
      emptyOutDir: true,
      sourcemap: false,
      // Split the heavy, rarely-changing libraries into their own chunks so a
      // code change does not force users to download the whole app again.
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-data': ['@tanstack/react-query', 'zustand'],
            'vendor-icons': ['lucide-react'],
            'vendor-socket': ['socket.io-client'],
          },
        },
      },
    },
    server: {
      port: 5174,
      proxy: {
        '/uploads': { target: apiUrl, changeOrigin: true },
        '/api': { target: apiUrl, changeOrigin: true },
        '/socket.io': { target: apiUrl, ws: true, changeOrigin: true },
      },
    },
  };
});
