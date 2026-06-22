import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(filePath) {
    return readFileSync(path.join(repoRoot, filePath), 'utf8');
}

describe('availability adapter boundary', () => {
    it('imports legacy availability helpers through the app alias', () => {
        const source = readRepoFile('apps/app/src/lib/adapters/legacyAvailability.ts');

        expect(source).toContain("from '@legacy/availability-preferences.js'");
        expect(source).not.toContain('../../../../../js/availability-preferences.js');
    });
});
