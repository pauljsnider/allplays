import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import appViteConfig from '../../apps/app/vite.config.ts';

const resolvedAppViteConfig = typeof appViteConfig === 'function'
    ? await appViteConfig({
        command: 'serve',
        mode: 'test',
        isSsrBuild: false,
        isPreview: false
    })
    : await appViteConfig;

describe('app Vite config', () => {
    it('keeps lazy routes out of the HTML module-preload fanout', () => {
        const resolveDependencies = resolvedAppViteConfig.build?.modulePreload &&
            typeof resolvedAppViteConfig.build.modulePreload === 'object'
            ? resolvedAppViteConfig.build.modulePreload.resolveDependencies
            : undefined;

        expect(resolveDependencies?.('index.js', ['route-a.js', 'route-b.js'], {
            hostId: 'index.html',
            hostType: 'html'
        })).toEqual([]);
        expect(resolveDependencies?.('route-a.js', ['shared.js'], {
            hostId: 'route-a.js',
            hostType: 'js'
        })).toEqual(['shared.js']);
        const manualChunks = resolvedAppViteConfig.build?.rollupOptions?.output?.manualChunks;
        expect(manualChunks?.('/workspace/node_modules/lucide-react/dist/cjs/lucide-react.js')).toBe('app-shell-vendor');
        expect(manualChunks?.('/workspace/node_modules/@sentry/browser/build/npm/esm/index.js')).toBeUndefined();
    });

    it('exposes the legacy JS directory through the @legacy alias', () => {
        expect(resolvedAppViteConfig.resolve?.alias).toEqual(expect.objectContaining({
            '@legacy': expect.stringContaining('/js')
        }));
    });

    it('resolves config-relative paths without CommonJS directory globals', () => {
        const viteConfigSource = readFileSync(new URL('../../apps/app/vite.config.ts', import.meta.url), 'utf8');

        expect(viteConfigSource).not.toContain('__dirname');
        expect(viteConfigSource).toContain('fileURLToPath(import.meta.url)');
        expect(viteConfigSource).toContain("path.resolve(appDirectory, '../../js')");
        expect(viteConfigSource).toContain("path.resolve(appDirectory, 'bundle-visualizer.html')");
    });

    it('enables app coverage reports across source files', () => {
        expect(resolvedAppViteConfig.test?.coverage).toEqual(expect.objectContaining({
            provider: 'v8',
            all: true,
            reporter: ['text', 'json', 'lcov'],
            include: ['src/**/*.{ts,tsx}']
        }));
    });
});
