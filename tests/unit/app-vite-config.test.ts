import path from 'node:path';
import { describe, expect, it } from 'vitest';

import appViteConfig from '../../apps/app/vite.config.ts';

describe('app Vite config', () => {
    it('keeps app source in the entry chunk', () => {
        const manualChunks = appViteConfig.build?.rollupOptions?.output?.manualChunks;

        expect(manualChunks?.('/workspace/apps/app/src/main.tsx')).toBeUndefined();
    });

    it('splits node_modules packages into stable vendor chunks', () => {
        const manualChunks = appViteConfig.build?.rollupOptions?.output?.manualChunks;
        const reactModule = path.join('/workspace', 'node_modules', 'react', 'index.js');
        const scopedModule = path.join('/workspace', 'node_modules', '@capacitor', 'core', 'dist', 'index.js');

        expect(manualChunks?.(reactModule)).toBe('vendor-react');
        expect(manualChunks?.(scopedModule)).toBe('vendor-@capacitor-core');
    });
});
