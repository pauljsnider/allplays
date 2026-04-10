import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('access code atomic redemption guard', () => {
    it('keeps generic access-code use inside a transaction', () => {
        const dbSourcePath = resolve(process.cwd(), 'js/db.js');
        const source = readFileSync(dbSourcePath, 'utf8');

        const fnAnchor = 'export async function markAccessCodeAsUsed';
        const fnIndex = source.indexOf(fnAnchor);
        expect(fnIndex).toBeGreaterThanOrEqual(0);

        const afterFunction = source.slice(fnIndex, fnIndex + 1800);
        expect(afterFunction).toContain('runTransaction(db, async (transaction) =>');
    });

    it('claims parent invite codes atomically before side effects', () => {
        const dbSourcePath = resolve(process.cwd(), 'js/db.js');
        const source = readFileSync(dbSourcePath, 'utf8');

        const fnAnchor = 'export async function redeemParentInvite';
        const fnIndex = source.indexOf(fnAnchor);
        expect(fnIndex).toBeGreaterThanOrEqual(0);

        const afterFunction = source.slice(fnIndex, fnIndex + 5000);
        expect(afterFunction).toContain('runTransaction(db, async (transaction) =>');
        expect(afterFunction).toContain('if (isAccessCodeExpired(latestCodeData.expiresAt))');
        expect(afterFunction).toContain('throw new Error("Code has expired")');
    });
});
