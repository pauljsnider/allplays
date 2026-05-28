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

    it('re-checks invite expiration before and during atomic redemption', () => {
        const dbSourcePath = resolve(process.cwd(), 'js/db.js');
        const source = readFileSync(dbSourcePath, 'utf8');

        const fnAnchor = 'export async function redeemAdminInviteAtomicPersistence';
        const fnIndex = source.indexOf(fnAnchor);
        expect(fnIndex).toBeGreaterThanOrEqual(0);

        const afterFunction = source.slice(fnIndex, fnIndex + 6000);
        const expirationGuard = "if (isAccessCodeExpired(codeData.expiresAt))";
        const latestExpirationGuard = "if (isAccessCodeExpired(latestCodeData.expiresAt))";

        expect(afterFunction).toContain(expirationGuard);
        expect(afterFunction).toContain(latestExpirationGuard);
    });

    it('requires the signed-in email to match the invited admin email', () => {
        const dbSourcePath = resolve(process.cwd(), 'js/db.js');
        const source = readFileSync(dbSourcePath, 'utf8');

        const persistenceAnchor = 'export async function redeemAdminInviteAtomicPersistence';
        const legacyAnchor = 'export async function redeemAdminInviteAtomically';
        const persistenceIndex = source.indexOf(persistenceAnchor);
        const legacyIndex = source.indexOf(legacyAnchor);
        expect(persistenceIndex).toBeGreaterThanOrEqual(0);
        expect(legacyIndex).toBeGreaterThanOrEqual(0);

        const persistenceFunction = source.slice(persistenceIndex, legacyIndex);
        const legacyFunction = source.slice(legacyIndex, legacyIndex + 2500);

        expect(persistenceFunction).toContain("const invitedEmail = String(codeData.email || '').trim().toLowerCase();");
        expect(persistenceFunction).toContain('if (normalizedEmail !== invitedEmail)');
        expect(persistenceFunction).toContain("const latestInvitedEmail = String(latestCodeData.email || '').trim().toLowerCase();");
        expect(persistenceFunction).toContain('if (normalizedEmail !== latestInvitedEmail)');
        expect(legacyFunction).toContain("const invitedEmail = String(codeData.email || '').trim().toLowerCase();");
        expect(legacyFunction).toContain('if (userEmail !== invitedEmail)');
    });
});
