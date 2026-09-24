import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { hasAdminInviteIssuerAccess } = require('../../functions/team-admin-access-core.cjs');

describe('admin invite server-authoritative redemption', () => {
    it('routes the callable through the server-authoritative redemption core', () => {
        const functionsSource = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');
        const handlerIndex = functionsSource.indexOf('exports.redeemAdminInvite');
        expect(handlerIndex).toBeGreaterThanOrEqual(0);

        const handlerSource = functionsSource.slice(handlerIndex, handlerIndex + 500);
        expect(handlerSource).toContain('functions.https.onCall(createRedeemAdminInviteHandler({');
        expect(handlerSource).toContain('firestore,');
        expect(handlerSource).toContain('getAuthUser: (uid) => admin.auth().getUser(uid),');
        expect(handlerSource).toContain('getTimestamp: () => admin.firestore.Timestamp.now(),');
        expect(handlerSource).toContain('HttpsError: functions.https.HttpsError,');
    });

    it('revalidates the issuer inside the transaction before any invite redemption writes', () => {
        const handlerSource = readFileSync(resolve(process.cwd(), 'functions/admin-invite-redemption-core.cjs'), 'utf8');
        const issuerCheckIndex = handlerSource.indexOf('if (!hasAdminInviteIssuerAccess({');
        const firstWriteIndex = handlerSource.indexOf('transaction.set(teamRef');

        expect(handlerSource).toContain('const issuerUid = normalizeStoredUid(codeData.generatedBy);');
        expect(handlerSource).toContain('transaction.get(issuerRef)');
        expect(handlerSource).toContain('getAuthUser(issuerUid)).catch(() => null)');
        expect(issuerCheckIndex).toBeGreaterThanOrEqual(0);
        expect(firstWriteIndex).toBeGreaterThan(issuerCheckIndex);
        expect(handlerSource.slice(issuerCheckIndex, firstWriteIndex))
            .toContain("new HttpsError('permission-denied'");
    });

    it.each([
        ['current owner', {
            team: { ownerId: 'owner-1', adminEmails: [] },
            user: {},
            uid: 'owner-1',
            authUser: { uid: 'owner-1', email: 'owner@example.com' }
        }, true],
        ['current email-listed administrator', {
            team: { ownerId: 'owner-1', adminEmails: ['admin@example.com'] },
            user: {},
            uid: 'admin-1',
            authUser: { uid: 'admin-1', email: 'ADMIN@example.com' }
        }, true],
        ['legacy owner with conflicting normalized aliases fails closed', {
            team: {
                ownerEmailLower: 'stale@example.com',
                ownerEmail: 'legacy-owner@example.com',
                adminEmails: []
            },
            user: {},
            uid: 'legacy-owner-1',
            authUser: { uid: 'legacy-owner-1', email: 'LEGACY-OWNER@example.com' }
        }, false],
        ['former owner email when canonical owner differs', {
            team: {
                ownerId: 'current-owner-1',
                ownerEmailLower: 'former-owner@example.com',
                ownerEmail: 'former-owner@example.com',
                adminEmails: []
            },
            user: {},
            uid: 'former-owner-1',
            authUser: { uid: 'former-owner-1', email: 'FORMER-OWNER@example.com' }
        }, false],
        ['current global administrator', {
            team: { ownerId: 'owner-1', adminEmails: [] },
            user: { isAdmin: true },
            uid: 'global-1',
            authUser: { uid: 'global-1', email: 'global@example.com' }
        }, true],
        ['removed administrator', {
            team: { ownerId: 'owner-1', adminEmails: [] },
            user: { email: 'removed@example.com' },
            uid: 'removed-1',
            authUser: { uid: 'removed-1', email: 'removed@example.com' }
        }, false],
        ['deleted issuer account', {
            team: { ownerId: 'owner-1', adminEmails: ['deleted@example.com'] },
            user: { email: 'deleted@example.com' },
            uid: 'deleted-1',
            authUser: null
        }, false],
        ['removed administrator redeeming a self-addressed invite', {
            team: { ownerId: 'owner-1', adminEmails: [] },
            user: { email: 'removed@example.com' },
            uid: 'removed-1',
            authUser: { uid: 'removed-1', email: 'removed@example.com' }
        }, false]
    ])('%s issuer authorization', (_label, input, expected) => {
        expect(hasAdminInviteIssuerAccess(input)).toBe(expected);
    });

    it('uses the issuer Auth email instead of a stale profile email', () => {
        expect(hasAdminInviteIssuerAccess({
            team: { ownerId: 'owner-1', adminEmails: ['old@example.com'] },
            user: { email: 'old@example.com' },
            uid: 'admin-1',
            authUser: { uid: 'admin-1', email: 'new@example.com' }
        })).toBe(false);
    });

    it('fails closed when an email-listed issuer has no authoritative Auth email', () => {
        expect(hasAdminInviteIssuerAccess({
            team: { ownerId: 'owner-1', adminEmails: ['old@example.com'] },
            user: { email: 'old@example.com' },
            uid: 'admin-1',
            authUser: { uid: 'admin-1' }
        })).toBe(false);
    });

    it('fails closed for conflicting legacy owner aliases', () => {
        expect(hasAdminInviteIssuerAccess({
            team: { ownerEmail: 'first@example.com', ownerEmailLower: 'second@example.com' },
            user: {},
            uid: 'legacy-owner',
            authUser: { uid: 'legacy-owner', email: 'first@example.com' }
        })).toBe(false);
        expect(hasAdminInviteIssuerAccess({
            team: { ownerEmail: ' Legacy@Example.com ', ownerEmailLower: 'legacy@example.com' },
            user: {},
            uid: 'legacy-owner',
            authUser: { uid: 'legacy-owner', email: 'legacy@example.com' }
        })).toBe(true);
    });

    it('routes legacy and React invite acceptance through the callable-backed adapter', () => {
        const adminInviteSource = readFileSync(resolve(process.cwd(), 'js/admin-invite.js'), 'utf8');
        const acceptInviteSource = readFileSync(resolve(process.cwd(), 'accept-invite.html'), 'utf8');
        const appAuthSource = readFileSync(resolve(process.cwd(), 'apps/app/src/lib/authService.ts'), 'utf8');

        expect(adminInviteSource).toContain("httpsCallable(functions, 'redeemAdminInvite')");
        expect(acceptInviteSource).toContain("import { redeemAdminInviteAtomically } from './js/admin-invite.js?v=12';");
        expect(appAuthSource).toContain('{ redeemAdminInviteAtomically }');
        expect(appAuthSource).toContain('redeemAdminInviteAtomically,');
        expect(appAuthSource).not.toContain('redeemAdminInviteAtomically: dbModule.redeemAdminInviteAtomically');
    });
});
