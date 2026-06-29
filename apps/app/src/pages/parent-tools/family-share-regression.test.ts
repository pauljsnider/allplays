import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, 'FamilyShareTool.tsx'), 'utf8');

describe('FamilyShareTool regression guards', () => {
    it('keeps save failures separate from load failures', () => {
        expect(source).toContain('const loadError = loadOperation.error;');
        expect(source).toContain('const saveError = saveOperation.error;');
        expect(source).toContain('{saveError ? <RetryableStatus error={saveError} fallbackMessage="Unable to save family share changes." /> : null}');
        expect(source).toContain('{!loadError && (loading ? <LoadingBlock label="Loading share links" /> : (');
    });
});
