import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');

describe('primary Firebase initialization', () => {
    it('does not treat named Firebase apps as the default app', () => {
        const source = readFileSync(join(repoRoot, 'js', 'firebase.js'), 'utf8');

        expect(source).toContain("candidate.name === '[DEFAULT]'");
        expect(source).toContain('existingDefaultApp || initializeApp(firebaseConfig)');
        expect(source).not.toContain('getApps().length ? getApp() : initializeApp(firebaseConfig)');
    });
});
