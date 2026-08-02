import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guidance = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');
const pathAwareUploadConsumers = [
    '../../player.html',
    '../../edit-roster.html',
    '../../apps/app/src/lib/statsheetImportService.ts',
    '../../apps/app/src/lib/playerService.ts',
    '../../apps/app/src/lib/teamDetailService.ts',
    '../../apps/app/src/lib/nativeStorageUpload.ts'
].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));

describe('agent regression guidance', () => {
    it('binds sensitive-state migrations to every reader sanitizer container', () => {
        expect(guidance).toContain("reader's sanitizer/private-field constants");
        expect(guidance).toContain('each flat alias, nested-object alias, and array-entry alias as the only historical private state');
        expect(guidance).toContain('prove detection, private copy, and scrub each run');
    });

    it('requires local file validation before a durable upload owner is created', () => {
        expect(guidance).toContain('MIME type, nonzero size, byte limit, and required metadata');
        expect(guidance).toContain('before creating that durable owner');
        expect(guidance).toContain('validation-before-owner and write-before-upload call-order tests');
    });

    it('requires a repository-wide image upload inventory without mandatory secondary auth', () => {
        expect(guidance).toContain('search all file inputs, native camera acquisition, direct `uploadBytes`/resumable calls, and `imageStorage` imports');
        expect(guidance).toContain('including certificate assets and signatures');
        expect(guidance).toContain('no production upload may hard-require its anonymous auth');
        expect(guidance).toContain('Every upload helper must return both the display URL and exact cleanup path');
        expect(guidance).toContain('every adapter, native wrapper, normalizer, persisted nested object, and test mock must preserve that object');
        expect(guidance).toContain('never narrow it back to a URL string or retain a compatibility branch that accepts a string-only success');
        expect(guidance).toContain('A failed read of the previous cleanup path is `unknown`');
        expect(guidance).toContain('Reconcile a removal after an ambiguous write even though it has no new upload path');
        pathAwareUploadConsumers.forEach((source) => {
            expect(source).not.toMatch(/typeof\s+uploaded(?:Photo)?\s*===\s*['"]string['"]/);
        });
    });
});
