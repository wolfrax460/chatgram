import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The landing page is served from the domain root ("/"), while the Flutter app
// lives alongside it at "/app/". Bundled JS/CSS go to /static so they never
// collide with the images in public/assets.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'static',
    emptyOutDir: true,
    sourcemap: false,
  },
});
