import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('React app email signup invite redemption dependencies', () => {
  it('passes household and co-parent invite redeemers into the shared signup flow', () => {
    const authServiceSource = readFileSync(resolve(process.cwd(), 'apps/app/src/lib/authService.ts'), 'utf8');

    const signupStart = authServiceSource.indexOf('export async function signUpWithEmail');
    const signupEnd = authServiceSource.indexOf('async function signInWithNativeGoogleCredential', signupStart);
    const signupSource = authServiceSource.slice(signupStart, signupEnd);

    expect(signupSource).toContain('redeemParentInvite: dbModule.redeemParentInvite');
    expect(signupSource).toContain('redeemFriendInvite: dbModule.redeemFriendInvite');
    expect(signupSource).toContain('redeemHouseholdInvite: dbModule.redeemHouseholdInvite');
    expect(signupSource).toContain('redeemCoParentInvite: dbModule.redeemCoParentInvite');
    expect(signupSource).toContain('rollbackParentInviteRedemption: dbModule.rollbackParentInviteRedemption');
  });

  it('keeps the legacy auth db adapter typed for co-parent invite redemption', () => {
    const adapterSource = readFileSync(resolve(process.cwd(), 'apps/app/src/lib/adapters/legacyAuth.ts'), 'utf8');

    expect(adapterSource).toContain('redeemCoParentInvite: (...args: any[]) => Promise<unknown>;');
    expect(adapterSource).toContain('redeemFriendInvite: (...args: any[]) => Promise<unknown>;');
    expect(adapterSource).toContain('rollbackParentInviteRedemption: (userId: string, code: string) => Promise<unknown>;');
    expect(adapterSource).toContain('redeemAdminInviteAtomically: (...args: any[]) => Promise<unknown>;');
  });

  it('passes the co-parent invite redeemer into signed-in app invite redemption', () => {
    const authServiceSource = readFileSync(resolve(process.cwd(), 'apps/app/src/lib/authService.ts'), 'utf8');

    const redeemStart = authServiceSource.indexOf('export async function redeemInviteForUser');
    const redeemEnd = authServiceSource.indexOf('export function rememberPendingInvite', redeemStart);
    const redeemSource = authServiceSource.slice(redeemStart, redeemEnd);

    expect(redeemSource).toContain('redeemParentInvite: dbModule.redeemParentInvite');
    expect(redeemSource).toContain('redeemFriendInvite: dbModule.redeemFriendInvite');
    expect(redeemSource).toContain('redeemHouseholdInvite: dbModule.redeemHouseholdInvite');
    expect(redeemSource).toContain('redeemCoParentInvite: dbModule.redeemCoParentInvite');
    expect(redeemSource).toContain('redeemAdminInviteAtomically');
  });
});
