import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));
const appNodeModules = path.resolve(workspaceRoot, 'apps/app/node_modules');

export default defineConfig({
  resolve: {
    alias: {
      react: path.resolve(appNodeModules, 'react'),
      'react-dom': path.resolve(appNodeModules, 'react-dom'),
      'react-router-dom': path.resolve(appNodeModules, 'react-router-dom'),
      'lucide-react': path.resolve(appNodeModules, 'lucide-react')
    },
    dedupe: ['react', 'react-dom', 'react-router-dom']
  }
});
