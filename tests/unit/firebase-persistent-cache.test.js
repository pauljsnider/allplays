import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');

describe('Firestore persistent local cache', () => {
    it('initializes Firestore with initializeFirestore instead of getFirestore', () => {
        const source = readFileSync(join(repoRoot, 'js', 'firebase.js'), 'utf8');

        expect(source).toContain('initializeFirestore');
        expect(source).not.toContain('getFirestore');
    });

    it('configures localCache with persistentLocalCache', () => {
        const source = readFileSync(join(repoRoot, 'js', 'firebase.js'), 'utf8');

        expect(source).toContain('persistentLocalCache');
        expect(source).toContain('localCache: persistentLocalCache(');
    });

    it('uses persistentMultipleTabManager to share the IndexedDB cache across browser tabs', () => {
        const source = readFileSync(join(repoRoot, 'js', 'firebase.js'), 'utf8');

        expect(source).toContain('persistentMultipleTabManager');
        expect(source).toContain('tabManager: persistentMultipleTabManager()');
    });
});
