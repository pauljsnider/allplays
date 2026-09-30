import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Public advisory GHSA-m9gg-hp2v-232j affects <1.13.6 and 1.14.0–1.14.4.
// Check every resolved occurrence, including nested Firebase/google-gax copies.
describe('patched gRPC dependency baseline', () => {
    for (const prefix of ['', 'apps/app/', 'functions/']) {
        it(`keeps all resolved gRPC copies patched in ${prefix || 'root/'}`, () => {
            const lock = JSON.parse(readFileSync(new URL(`../../${prefix}package-lock.json`, import.meta.url), 'utf8'));
            const versions = Object.entries(lock.packages)
                .filter(([name]) => name.endsWith('/@grpc/grpc-js'))
                .map(([, entry]) => entry.version);
            expect(versions.length).toBeGreaterThan(0);
            for (const version of versions) {
                expect(version).toMatch(/^\d+\.\d+\.\d+$/);
                const [major, minor, patch] = version.split('.').map(Number);
                const patched = major > 1 || (major === 1 && (minor > 14
                    || (minor === 14 && patch >= 5) || (minor === 13 && patch >= 6)));
                expect(patched).toBe(true);
            }
        });
    }
});
