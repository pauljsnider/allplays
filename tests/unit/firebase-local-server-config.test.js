import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { buildLocalFirebaseConfig } from '../../scripts/serve-firebase-local.mjs';

describe('local Firebase Hosting configuration', () => {
    it('disables browser caching locally without changing production headers', () => {
        const source = {
            hosting: {
                public: '.',
                headers: [
                    {
                        source: '**',
                        headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'" }]
                    },
                    {
                        source: '**/*.@(js|css)',
                        headers: [{ key: 'Cache-Control', value: 'max-age=3600' }]
                    }
                ]
            }
        };

        const local = buildLocalFirebaseConfig(source, 'demo-allplays');

        expect(local.hosting.headers[0].headers).toContainEqual({ key: 'Cache-Control', value: 'no-store' });
        expect(local.hosting.headers[0].headers).toContainEqual({
            key: 'X-AllPlays-Local-Firebase-Project',
            value: 'demo-allplays'
        });
        expect(local.hosting.headers[1].headers).toEqual([{ key: 'Cache-Control', value: 'no-store' }]);
        expect(source.hosting.headers[0].headers).toEqual([
            { key: 'Content-Security-Policy', value: "default-src 'self'" }
        ]);
        expect(source.hosting.headers[1].headers).toEqual([
            { key: 'Cache-Control', value: 'max-age=3600' }
        ]);
    });

    it('routes every local Hosting command through the no-cache launcher', () => {
        const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

        expect(packageJson.scripts['serve:firebase']).toBe(
            'node scripts/serve-firebase-local.mjs demo-allplays'
        );
        expect(packageJson.scripts['serve:firebase:live']).toBe(
            'node scripts/serve-firebase-local.mjs game-flow-c6311'
        );
        expect(packageJson.scripts['serve:firebase:safe']).toBe(
            'node scripts/serve-firebase-local.mjs demo-allplays'
        );
    });

    it('documents production-backed local data behind the explicit live command', () => {
        const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
        const productionSection = readme.match(
            /Production-backed local development[\s\S]*?Safe isolated development/
        )?.[0] || '';

        expect(productionSection).toContain('npm run serve:firebase:live');
        expect(productionSection).not.toMatch(/npm run serve:firebase\s*\n/);
        expect(readme).toContain('default `serve:firebase` command');
    });

    it('rejects an invalid expected project before generating local Hosting config', () => {
        expect(() => buildLocalFirebaseConfig({ hosting: {} }, '../production')).toThrow(
            'A valid Firebase project ID is required for local Hosting.'
        );
    });
});
