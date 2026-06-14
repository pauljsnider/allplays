import path from 'node:path';
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
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          const normalizedId = id.split(path.sep).join('/');
          const packageRoot = normalizedId.split('/node_modules/')[1];
          const packageName = packageRoot?.startsWith('@')
            ? packageRoot.split('/').slice(0, 2).join('/')
            : packageRoot?.split('/')[0];

          if (!packageName) {
            return 'vendor';
          }

          return `vendor-${packageName.replace(/[\/]/g, '-')}`;
        }
      }
    }
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
