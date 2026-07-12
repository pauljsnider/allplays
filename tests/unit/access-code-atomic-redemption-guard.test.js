import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('access code atomic redemption guard', () => {
    it('claims generic access codes without reading protected access-code documents', () => {
        const dbSourcePath = resolve(process.cwd(), 'js/db.js');
        const source = readFileSync(dbSourcePath, 'utf8');

        const fnAnchor = 'export async function markAccessCodeAsUsed';
        const fnIndex = source.indexOf(fnAnchor);
        expect(fnIndex).toBeGreaterThanOrEqual(0);

        const nextFunctionIndex = source.indexOf('\nexport async function', fnIndex + fnAnchor.length);
        const afterFunction = source.slice(fnIndex, nextFunctionIndex);
        expect(afterFunction).toContain('runTransaction(db, async (transaction) =>');
        expect(afterFunction).toContain('transaction.update(codeRef');
        expect(afterFunction).toContain('usedAt: serverTimestamp()');
        expect(afterFunction).not.toContain('transaction.get(codeRef)');
        expect(afterFunction).not.toContain('codeSnapshot.data()');
    });

    it('routes parent invite membership grants through a callable instead of browser membership writes', () => {
        const dbSourcePath = resolve(process.cwd(), 'js/db.js');
        const source = readFileSync(dbSourcePath, 'utf8');

        const fnAnchor = 'export async function redeemParentInvite';
        const fnIndex = source.indexOf(fnAnchor);
        expect(fnIndex).toBeGreaterThanOrEqual(0);

        const afterFunction = source.slice(fnIndex, fnIndex + 1400);
        expect(afterFunction).toContain("httpsCallable(functions, 'redeemParentInvite')");
        expect(afterFunction).toContain('await syncPublicUserProfile(userId);');
        expect(afterFunction).not.toContain('parentOf: arrayUnion');
        expect(afterFunction).not.toContain('parentTeamIds: arrayUnion');
        expect(afterFunction).not.toContain('parentPlayerKeys: arrayUnion');
    });

    it('routes failed signup invite recovery through a callable instead of browser rollback writes', () => {
        const dbSourcePath = resolve(process.cwd(), 'js/db.js');
        const source = readFileSync(dbSourcePath, 'utf8');

        const fnAnchor = 'export async function rollbackParentInviteRedemption';
        const fnIndex = source.indexOf(fnAnchor);
        expect(fnIndex).toBeGreaterThanOrEqual(0);

        const afterFunction = source.slice(fnIndex, fnIndex + 900);
        expect(afterFunction).toContain("httpsCallable(functions, 'cleanupFailedInviteSignup')");
        expect(afterFunction).not.toContain('collection(db, "accessCodes")');
        expect(afterFunction).not.toContain('updateDoc(codeDoc.ref');
        expect(afterFunction).not.toContain('syncPublicUserProfile(userId)');
    });

    it('claims parent invite codes and membership grants atomically in the privileged callable', () => {
        const functionsSourcePath = resolve(process.cwd(), 'functions/index.js');
        const source = readFileSync(functionsSourcePath, 'utf8');

        const fnAnchor = 'exports.redeemParentInvite';
        const fnIndex = source.indexOf(fnAnchor);
        expect(fnIndex).toBeGreaterThanOrEqual(0);

        const afterFunction = source.slice(fnIndex, fnIndex + 6800);
        expect(afterFunction).toContain('firestore.runTransaction(async (transaction) =>');
        expect(afterFunction).toContain("codeData.type !== 'parent_invite'");
        expect(afterFunction).toContain('codeData.used || codeData.revoked === true || codeData.status ===');
        expect(afterFunction).toContain('isParentInviteExpired(codeData.expiresAt)');
        expect(afterFunction).toContain('invitedEmail && (!signedInEmail || invitedEmail !== signedInEmail)');
        expect(afterFunction).toContain('parentOf: nextUserData.parentOf');
        expect(afterFunction).toContain('parentTeamIds: nextUserData.parentTeamIds');
        expect(afterFunction).toContain('parentPlayerKeys: nextUserData.parentPlayerKeys');
        expect(afterFunction).toContain('admin.firestore.FieldValue.arrayUnion');
        expect(afterFunction).toContain("status: 'accepted'");
    });

    it('recovers recent failed invite signups through a privileged callable and auth-delete trigger', () => {
        const functionsSourcePath = resolve(process.cwd(), 'functions/index.js');
        const source = readFileSync(functionsSourcePath, 'utf8');

        const callableIndex = source.indexOf('exports.cleanupFailedInviteSignup');
        expect(callableIndex).toBeGreaterThanOrEqual(0);
        const callableSource = source.slice(callableIndex, callableIndex + 900);
        expect(callableSource).toContain('context.auth?.uid');
        expect(callableSource).toContain('cleanupFailedInviteSignupForUser(userId, { code })');

        const helperIndex = source.indexOf('async function cleanupFailedInviteSignupForUser');
        expect(helperIndex).toBeGreaterThanOrEqual(0);
        const helperSource = source.slice(helperIndex, helperIndex + 5200);
        expect(helperSource).toContain("firestore.collection('accessCodes').where('usedBy', '==', normalizedUserId)");
        expect(helperSource).toContain('isRecentFailedSignupInviteRedemption(data, normalizedUserId, nowMillis)');
        expect(helperSource).toContain('used: false');
        expect(helperSource).toContain('usedBy: null');
        expect(helperSource).toContain('usedAt: null');
        expect(helperSource).toContain('transaction.delete(publicProfileRef)');
        expect(helperSource).toContain('transaction.delete(userRef)');
        expect(helperSource).toContain("parents.filter((parent) => String(parent?.userId || '').trim() !== normalizedUserId)");

        expect(source).toContain('exports.cleanupInviteSignupOnAuthDelete = functions.auth.user().onDelete');
    });
});
