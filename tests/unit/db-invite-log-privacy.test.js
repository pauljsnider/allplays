import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function extractFunction(signature) {
    const start = dbSource.indexOf(signature);
    expect(start, `Expected function signature to exist: ${signature}`).toBeGreaterThanOrEqual(0);
    const braceStart = dbSource.indexOf('{', start);
    let depth = 1;
    for (let index = braceStart + 1; index < dbSource.length; index += 1) {
        if (dbSource[index] === '{') depth += 1;
        if (dbSource[index] === '}') depth -= 1;
        if (depth === 0) return dbSource.slice(start, index + 1);
    }
    throw new Error(`Unable to extract function: ${signature}`);
}

function buildInviteFunction(functionName, dependencies) {
    const source = extractFunction(`export async function ${functionName}(`)
        .replace(`export async function ${functionName}`, `return async function ${functionName}`);
    return new Function(
        'httpsCallable',
        'functions',
        'syncPublicUserProfile',
        'normalizeInviteEmail',
        'normalizeHouseholdInviteEmail',
        'auth',
        source
    )(
        dependencies.httpsCallable,
        {},
        dependencies.syncPublicUserProfile,
        (email) => String(email || '').trim().toLowerCase(),
        (email) => String(email || '').trim().toLowerCase(),
        { currentUser: { email: 'SignedIn@Example.com' } }
    );
}

describe('invite redemption client-log privacy', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps redemption behavior while omitting raw user, code, and codeId values from logs', async () => {
        const sensitiveUserId = 'raw-user-privacy-123';
        const sensitiveCode = 'raw-code-privacy-456';
        const sensitiveCodeId = 'raw-code-id-privacy-789';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const syncPublicUserProfile = vi.fn(async () => undefined);
        const callables = new Map();
        const httpsCallable = vi.fn((_functions, name) => {
            const callable = vi.fn(async () => ({
                data: {
                    success: true,
                    codeId: sensitiveCodeId,
                    teamId: 'team-1',
                    playerId: 'player-1'
                }
            }));
            callables.set(name, callable);
            return callable;
        });

        for (const [functionName, callableName] of [
            ['redeemParentInvite', 'redeemParentInvite'],
            ['redeemCoParentInvite', 'redeemCoParentInvite'],
            ['redeemHouseholdInvite', 'redeemHouseholdInvite']
        ]) {
            const redeem = buildInviteFunction(functionName, { httpsCallable, syncPublicUserProfile });
            const result = await redeem(sensitiveUserId, sensitiveCode, 'Invitee@Example.com');

            expect(result).toEqual(expect.objectContaining({
                success: true,
                teamId: 'team-1',
                playerId: 'player-1'
            }));
            expect(callables.get(callableName)).toHaveBeenCalledWith(expect.objectContaining({
                userId: sensitiveUserId,
                code: sensitiveCode.toUpperCase()
            }));
        }
        expect(syncPublicUserProfile).toHaveBeenCalledTimes(3);

        const serializedLogs = JSON.stringify(logSpy.mock.calls);
        expect(serializedLogs).not.toContain(sensitiveUserId);
        expect(serializedLogs).not.toContain(sensitiveCode);
        expect(serializedLogs).not.toContain(sensitiveCode.toUpperCase());
        expect(serializedLogs).not.toContain(sensitiveCodeId);
    });

    it('returns rollback results unchanged without logging their sensitive payload', async () => {
        const sensitiveUserId = 'rollback-user-privacy-123';
        const sensitiveCode = 'rollback-code-privacy-456';
        const payload = { success: true, codeId: 'rollback-code-id-privacy-789' };
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const cleanupFailedInviteSignup = vi.fn(async () => ({ data: payload }));
        const rollback = buildInviteFunction('rollbackParentInviteRedemption', {
            httpsCallable: vi.fn(() => cleanupFailedInviteSignup),
            syncPublicUserProfile: vi.fn()
        });

        await expect(rollback(sensitiveUserId, sensitiveCode)).resolves.toBe(payload);
        expect(cleanupFailedInviteSignup).toHaveBeenCalledWith({
            userId: sensitiveUserId,
            code: sensitiveCode.toUpperCase()
        });

        const serializedLogs = JSON.stringify(logSpy.mock.calls);
        expect(serializedLogs).not.toContain(sensitiveUserId);
        expect(serializedLogs).not.toContain(sensitiveCode);
        expect(serializedLogs).not.toContain(sensitiveCode.toUpperCase());
        expect(serializedLogs).not.toContain(payload.codeId);
    });
});
