import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');

describe('Firestore local cache policy', () => {
    it('initializes Firestore with initializeFirestore and falls back to getFirestore when needed', () => {
        const source = readFileSync(join(repoRoot, 'js', 'firebase.js'), 'utf8');

        expect(source).toContain('initializeFirestore');
        expect(source).toContain('getFirestore');
        expect(source).toContain("initializeFirestore() has already been called");
    });

    it('uses memory cache for web while retaining persistent cache for native runtimes', () => {
        const source = readFileSync(join(repoRoot, 'js', 'firebase.js'), 'utf8');

        expect(source).toContain('memoryLocalCache');
        expect(source).toContain('persistentLocalCache');
        expect(source).toContain('isCapacitorNativeFirestoreRuntime');
        expect(source).toContain('localCache: createFirestoreLocalCache(privacyState)');
        expect(source).toContain('clearIndexedDbPersistence');
        expect(source).toContain("REPLAY_PRIVACY_CACHE_EPOCH = 'private-replay-v2'");
        expect(source).toContain("'getReplayPrivacyMigrationStatus'");
        expect(source).toContain('await clearRetiredFirestoreCache(firestore, privacyState)');
        expect(source).toContain('privacyState?.ready === true');
    });

    it('keeps the persistent multi-tab manager scoped to native Firestore', () => {
        const source = readFileSync(join(repoRoot, 'js', 'firebase.js'), 'utf8');

        expect(source).toContain('persistentMultipleTabManager');
        expect(source).toContain('tabManager: persistentMultipleTabManager()');
        expect(source).toMatch(/if \(isCapacitorNativeFirestoreRuntime\(\) && privacyState\?\.ready === true\)[\s\S]*persistentLocalCache/);
    });
});
