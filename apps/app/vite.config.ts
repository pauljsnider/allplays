import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { patchBundleVisualizerTooltipFile } from './build/fixBundleVisualizerTooltip.js';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
const bundleVisualizerTooltipFixPlugin = {
  name: 'bundle-visualizer-tooltip-fix',
  apply: 'build',
  writeBundle() {
    patchBundleVisualizerTooltipFile(path.resolve(appDirectory, 'bundle-visualizer.html'));
  }
};

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@legacy': path.resolve(appDirectory, '../../js')
    }
  },
  plugins: [
    react(),
    visualizer({
      filename: 'bundle-visualizer.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false
    }),
    bundleVisualizerTooltipFixPlugin
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
          const normalizedId = id.split(path.sep).join('/');
          const legacyFirebaseMatch = normalizedId.match(/\/js\/vendor\/firebase-([a-z-]+)\.js$/);
          if (legacyFirebaseMatch) {
            // Keep App Check from pulling the much larger Firestore client into
            // the authentication bootstrap chunk through their shared app core.
            return `legacy-firebase-${legacyFirebaseMatch[1]}`;
          }

          if (!id.includes('node_modules')) {
            return undefined;
          }

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
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      reportsDirectory: './coverage',
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/setupTests.ts',
        'src/**/*.d.ts'
      ]
    }
  }
});
