import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    // Add Vitest-specific configurations here
  },
  server: {
    // Ignore source maps for vendor files during development/testing
    sourcemapIgnoreList: (sourcePath) => sourcePath.includes('js/vendor/'),
  },
});
