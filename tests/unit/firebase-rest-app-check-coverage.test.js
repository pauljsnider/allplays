import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const primaryRestCallers = [
    '../../apps/app/src/lib/authService.ts',
    '../../apps/app/src/lib/chatService.ts',
    '../../apps/app/src/lib/profileService.ts',
    '../../apps/app/src/lib/scheduleService.ts',
    '../../apps/app/src/lib/teamDetailService.ts',
    '../../js/public-rsvp-telemetry.js',
    '../../js/schedule-notifications.js',
    '../../js/team-pass.js',
    '../../js/telemetry.js'
];
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function listSourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'vendor') return [];
            return listSourceFiles(entryPath);
        }
        return /\.(js|ts|tsx)$/.test(entry.name) && !/\.test\.[^.]+$/.test(entry.name)
            ? [entryPath]
            : [];
    });
}

describe('raw Firebase REST App Check coverage', () => {
    it('keeps an exhaustive inventory of direct Firebase REST fetch callers', () => {
        const markers = /identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firestore\.googleapis\.com|firebasestorage\.googleapis\.com|cloudfunctions\.net/;
        const inventoriedCallers = [
            ...listSourceFiles(path.join(repoRoot, 'js')),
            ...listSourceFiles(path.join(repoRoot, 'apps', 'app', 'src'))
        ]
            .filter((filePath) => {
                const source = readFileSync(filePath, 'utf8');
                return source.includes('fetch(') && markers.test(source);
            })
            .map((filePath) => path.relative(repoRoot, filePath).split(path.sep).join('/'))
            .sort();

        expect(inventoriedCallers).toEqual([
            'apps/app/src/lib/authService.ts',
            'apps/app/src/lib/chatService.ts',
            'apps/app/src/lib/profilePhotoService.ts',
            'apps/app/src/lib/profileService.ts',
            'apps/app/src/lib/scheduleService.ts',
            'apps/app/src/lib/teamDetailService.ts',
            'js/public-rsvp-telemetry.js',
            'js/schedule-notifications.js',
            'js/team-pass.js',
            'js/telemetry.js'
        ]);
    });

    it.each(primaryRestCallers)('attaches through the primary-project URL guard in %s', (relativePath) => {
        const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

        expect(source).toContain('getPrimaryAppCheckHeaders');
        expect(source).toMatch(/getPrimaryAppCheckHeaders\([\s\S]*?(requestUrl|endpoint)/);
    });

    it('keeps the independent game-flow-img auth and storage client isolated', () => {
        const source = readFileSync(
            new URL('../../apps/app/src/lib/profilePhotoService.ts', import.meta.url),
            'utf8'
        );

        expect(source).toContain('resolveImageFirebaseConfig');
        expect(source).not.toContain('getPrimaryAppCheckHeaders');
        expect(source).toContain('identitytoolkit.googleapis.com');
        expect(source).toContain('firebasestorage.googleapis.com');
    });

    it('allows App Check through CORS on raw functions that receive attested browser requests', () => {
        const appCheckCorsHeader = "res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');";

        expect(functionsSource.split(appCheckCorsHeader)).toHaveLength(3);
    });
});
