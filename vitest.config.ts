import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));
const appNodeModules = path.resolve(workspaceRoot, 'apps/app/node_modules');
const rootNodeModules = path.resolve(workspaceRoot, 'node_modules');
// When running from a git worktree the local node_modules dirs may not exist;
// fall back to the parent checkout that owns the actual installs.
const parentRoot = path.resolve(workspaceRoot, '../../..');
const parentAppNodeModules = path.resolve(parentRoot, 'apps/app/node_modules');
const parentRootNodeModules = path.resolve(parentRoot, 'node_modules');

function resolveModule(moduleName: string, relativePath = moduleName) {
  for (const base of [appNodeModules, rootNodeModules, parentAppNodeModules, parentRootNodeModules]) {
    const resolved = path.resolve(base, relativePath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  if (moduleName === 'lucide-react') {
    return path.resolve(workspaceRoot, 'tests/support/lucide-react-stub.ts');
  }

  return path.resolve(rootNodeModules, relativePath);
}

export default defineConfig({
  resolve: {
    alias: {
      react: resolveModule('react'),
      'react-dom': resolveModule('react-dom'),
      'react-router-dom': resolveModule('react-router-dom'),
      'lucide-react': resolveModule('lucide-react'),
      '@testing-library/react': resolveModule('@testing-library/react'),
      '@capacitor/app': resolveModule('@capacitor/app'),
      '@capacitor/core': resolveModule('@capacitor/core'),
      '@capacitor/browser': resolveModule('@capacitor/browser'),
      '@capacitor/camera': resolveModule('@capacitor/camera'),
      '@capacitor/filesystem': resolveModule('@capacitor/filesystem'),
      '@capacitor/share': resolveModule('@capacitor/share'),
      '@capacitor-firebase/messaging': resolveModule('@capacitor-firebase/messaging'),
      '@capawesome/capacitor-badge': resolveModule('@capawesome/capacitor-badge'),
      'dompurify': resolveModule('dompurify'),
      '@legacy': path.resolve(workspaceRoot, 'js')
    },
    dedupe: ['react', 'react-dom', 'react-router-dom']
  }
});
