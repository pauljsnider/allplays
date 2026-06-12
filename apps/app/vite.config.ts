import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    visualizer({
      filename: 'bundle-visualizer.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false
    })
  ],
  server: {
    port: 5174,
    fs: {
      allow: ['../..']
    }
  },
  build: {
    chunkSizeWarningLimit: 1400
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    // you might want to disable it to process CSS files like Tailwind
    // relevant for Tailwind JIT, etc.
    css: false,
  },
});
