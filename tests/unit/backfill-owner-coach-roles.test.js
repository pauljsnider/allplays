import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationSource = readFileSync(new URL('../../_migration/backfill-owner-coach-roles.js', import.meta.url), 'utf8');

describe('backfill owner coach roles migration', () => {
    it('rejects a missing or flag-like team ID before running the migration', () => {
        expect(migrationSource).toContain("!teamFlagValue || teamFlagValue.startsWith('--')");
        expect(migrationSource).toContain('Missing team ID after --team. No changes were made.');
        expect(migrationSource.indexOf("process.exit(1)")).toBeLessThan(migrationSource.indexOf('async function main()'));
    });
});
