import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { patchBundleVisualizerTooltipFile } from './build/fixBundleVisualizerTooltip.js';
import { assertSafeAppCheckBuildEnvironment } from './build/appCheckBuildGuard.js';
import { createProductionArtifactGuard } from './build/productionArtifactGuard.js';
import { createNativeFirebaseRuntimeTransform } from './build/nativeFirebaseRuntimeTransform';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDirectory, '../..');

// https://vitejs.dev/config/
const bundleVisualizerTooltipFixPlugin = {
  name: 'bundle-visualizer-tooltip-fix',
  apply: 'build',
  writeBundle() {
    patchBundleVisualizerTooltipFile(path.resolve(appDirectory, 'bundle-visualizer.html'));
  }
};

export default defineConfig(({ mode }) => {
  assertSafeAppCheckBuildEnvironment(mode, loadEnv(mode, appDirectory, 'VITE_'));

  return {
  base: './',
  resolve: {
    alias: {
      '@legacy': path.resolve(appDirectory, '../../js'),
      // Legacy Firebase bootstrap modules live outside apps/app, so bare
      // imports from those files would otherwise walk toward the repository
      // root. Resolve the native plugin from this app package explicitly so
      // the isolated app-quality install is sufficient in CI and deployments.
      '@capacitor-firebase/app-check': path.resolve(
        appDirectory,
        'node_modules/@capacitor-firebase/app-check'
      )
    }
  },
  plugins: [
    createNativeFirebaseRuntimeTransform(repoRoot),
    react(),
    visualizer({
      filename: 'bundle-visualizer.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false
    }),
    bundleVisualizerTooltipFixPlugin,
    createProductionArtifactGuard({ appDirectory, repoRoot })
  ],
  server: {
    port: 5174,
    proxy: {
      '/__allplays/calendar': {
        target: 'https://us-central1-game-flow-c6311.cloudfunctions.net',
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/__allplays\/calendar/, '/fetchCalendarIcs')
      }
    },
    fs: {
      allow: ['../..']
    }
  },
  build: {
    chunkSizeWarningLimit: 1400,
    modulePreload: {
      resolveDependencies(_filename, dependencies, context) {
        // Route components already use dynamic imports. Preloading every shared
        // route dependency from index.html defeated that boundary and produced
        // nearly one hundred cold-start requests before sign-in was usable.
        return context.hostType === 'html' ? [] : dependencies;
      }
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.split(path.sep).join('/');
          if (/\/node_modules\/(?:react|react-dom|react-router|react-router-dom|lucide-react)\//.test(normalizedId)) {
            return 'app-shell-vendor';
          }
          if (/\/apps\/app\/src\/lib\/(?:authService|profileService|profilePhotoService|appDataCache|appErrors|logger|telemetry|nativeRuntime|nativeRestDedup|nativeBackButton|pushNotificationRouting|workflowTiming|uxTiming|appLinks)\.(?:ts|tsx)$/.test(normalizedId)) {
            return 'app-shell-auth';
          }
          if (/\/apps\/app\/src\/lib\/(?:scheduleService|scheduleLogic|teamDetailService|homeService|homeLogic|chatService|chatLogic|parentToolsService|rosterAiImport|gameWrapupService|gameDayLineupBuilder|gameDayLineupPublish)\.(?:ts|tsx)$/.test(normalizedId)) {
            return 'app-shell-team-data';
          }
          if (/\/js\/(?:db|firebase|firebase-runtime-config|firebase-app-check-rest|utils|legacyScheduleHelpers|roster-profile-fields)\.js$/.test(normalizedId)) {
            return 'app-shell-legacy-data';
          }
          return undefined;
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
  };
});
