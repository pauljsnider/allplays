import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('_migration/fix-orphaned-invite-redemptions.js', 'utf8');
const readme = readFileSync('_migration/MIGRATION-README.md', 'utf8');

describe('orphaned invite redemption migration safety', () => {
    it('defaults to a dry run and refuses unscoped apply mode', () => {
        expect(source).toContain("const APPLY = process.argv.includes('--apply');");
        expect(source).toContain('if (APPLY && !onlyCode)');
        expect(source).toContain('bulk writes are disabled');
    });

    it('documents a scoped dry run before the matching apply command', () => {
        expect(readme).toContain('--code 7PPHXY3R  # dry run, one code');
        expect(readme).toContain('--apply --code 7PPHXY3R');
        expect(readme).toContain('bulk writes are not supported');
    });

    it('only repairs codes owned by deleted Firebase Auth users', () => {
        expect(source).toContain("error?.code === 'auth/user-not-found'");
        expect(source).toContain('await authRecordExists(auth, uid)');
        expect(source).toContain("db.collection('accessCodes').where('used', '==', true)");
    });
});
