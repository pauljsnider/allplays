import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('admin invite server-authoritative redemption', () => {
    it('exposes a callable that validates invite identity and mutates team, user, and access code in one transaction', () => {
        const functionsSource = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');
        const handlerIndex = functionsSource.indexOf('exports.redeemAdminInvite');
        expect(handlerIndex).toBeGreaterThanOrEqual(0);

        const handlerSource = functionsSource.slice(handlerIndex, handlerIndex + 5200);
        expect(handlerSource).toContain('functions.https.onCall');
        expect(handlerSource).toContain('firestore.runTransaction(async (transaction) =>');
        expect(handlerSource).toContain("codeData.type !== 'admin_invite'");
        expect(handlerSource).toContain('codeData.used');
        expect(handlerSource).toContain('isParentInviteExpired(codeData.expiresAt)');
        expect(handlerSource).toContain('invitedEmail !== signedInEmail');
        expect(handlerSource).toContain('context.auth.token?.email || userData.email');
        expect(handlerSource).not.toContain('data?.userEmail || data?.authEmail');
        expect(handlerSource).toContain('userId !== context.auth.uid');
        expect(handlerSource).toContain('adminEmails: appendUniqueValue');
        expect(handlerSource).toContain('coachOf: appendUniqueValue');
        expect(handlerSource).toContain("roles: appendUniqueValue(userData.roles, 'coach')");
        expect(handlerSource).toContain('transaction.update(codeRef');
        expect(handlerSource).toContain('used: true');
        expect(handlerSource).toContain('usedBy: userId');
        expect(handlerSource).toContain('usedAt: now');
    });

    it('routes legacy and React invite acceptance through the callable-backed adapter', () => {
        const adminInviteSource = readFileSync(resolve(process.cwd(), 'js/admin-invite.js'), 'utf8');
        const acceptInviteSource = readFileSync(resolve(process.cwd(), 'accept-invite.html'), 'utf8');
        const appAuthSource = readFileSync(resolve(process.cwd(), 'apps/app/src/lib/authService.ts'), 'utf8');

        expect(adminInviteSource).toContain("httpsCallable(functions, 'redeemAdminInvite')");
        expect(acceptInviteSource).toContain("import { redeemAdminInviteAtomically } from './js/admin-invite.js?v=6';");
        expect(appAuthSource).toContain('{ redeemAdminInviteAtomically }');
        expect(appAuthSource).toContain('redeemAdminInviteAtomically,');
        expect(appAuthSource).not.toContain('redeemAdminInviteAtomically: dbModule.redeemAdminInviteAtomically');
    });
});
