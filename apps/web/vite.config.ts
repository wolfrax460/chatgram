import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Chunk 7D: write /web/version.json next to the built app. It carries a build id
 * generated at build time; the running app polls it every 10 minutes (and on tab
 * focus) and offers a refresh when a newer build is deployed. The file contains
 * nothing secret and nothing user-specific.
 */
function versionFilePlugin(): Plugin {
  const buildId =
    process.env.VITE_BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    `${Date.now().toString(36)}`;
  const builtAt = new Date().toISOString();
  return {
    name: 'chatgram-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ buildId, builtAt })}\n`,
      });
    },
  };
}

// Served at /web/ alongside the legacy Flutter app at /app/ during migration.
export default defineConfig(({ mode }) => {
  // In development the API runs on another port. Uploaded media is stored as a
  // server-relative `/uploads/...` URL when Cloudinary is not configured, so the
  // dev server proxies that path to the API. In production the web app and the
  // API share an origin and no proxy is involved.
  const apiUrl = (process.env.VITE_API_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');

  return {
    plugins: [react(), versionFilePlugin()],
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
      // Bind IPv4 loopback so the dev app and the API are the SAME site
      // (127.0.0.1:<port>): the admin session cookie is SameSite=Strict and is
      // otherwise dropped between `localhost` and `127.0.0.1`.
      host: '127.0.0.1',
      port: 5174,
      proxy: {
        '/uploads': { target: apiUrl, changeOrigin: true },
        '/api': { target: apiUrl, changeOrigin: true },
        '/socket.io': { target: apiUrl, ws: true, changeOrigin: true },
      },
    },
  };
});
