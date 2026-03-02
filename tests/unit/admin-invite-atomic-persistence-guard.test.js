import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('admin invite atomic persistence guard', () => {
    it('keeps adminEmails append atomic inside transaction', () => {
        const dbSourcePath = resolve(process.cwd(), 'js/db.js');
        const source = readFileSync(dbSourcePath, 'utf8');

        const fnAnchor = 'export async function redeemAdminInviteAtomicPersistence';
        const fnIndex = source.indexOf(fnAnchor);
        expect(fnIndex).toBeGreaterThanOrEqual(0);

        const afterFunction = source.slice(fnIndex, fnIndex + 6000);
        expect(afterFunction).toContain('runTransaction(db, async (transaction) =>');
        expect(afterFunction).toContain('adminEmails: arrayUnion(normalizedEmail)');
    });
});
