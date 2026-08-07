import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('verified-email sensitive action coverage', () => {
  it('routes high-impact server mutations through the shared staged guard', () => {
    expect(functionsSource).toContain("require('./verified-email-policy.cjs')");
    [
      'sync-registration-provider',
      'claim-open-officiating-slot',
      'publish-organization-schedule',
      'queue-invite-email',
      'confirm-parent-account-merge',
      'revoke-household-member-access',
      'preview-account-merge',
      'create-scoped-rsvp-token',
      'create-team-pass-checkout',
      'create-team-fee-checkout',
      'refund-team-fee-payment',
      'post-shared-game-cancellation',
      'send-team-email',
      'send-authorized-direct-message'
    ].forEach((operation) => {
      expect(functionsSource).toContain(`await assertSensitiveEmailVerified(context, '${operation}');`);
    });
    expect(functionsSource).toMatch(
      /await assertSensitiveEmailVerified\(\{[\s\S]{0,500}\}, 'sync-public-user-profile-projection'\);/
    );
  });

  it('keeps verification delivery outside the staged gate and requires verified family invite identity', () => {
    const queueVerificationStart = functionsSource.indexOf('exports.queueEmailVerification');
    const queueInviteStart = functionsSource.indexOf('exports.queueInviteSignInEmail');
    const redeemInviteStart = functionsSource.indexOf('exports.redeemParentInvite');
    const redeemHouseholdStart = functionsSource.indexOf('exports.redeemHouseholdInvite');
    const redeemCoParentStart = functionsSource.indexOf('exports.redeemCoParentInvite');
    const redeemAdminStart = functionsSource.indexOf('exports.redeemAdminInvite');
    expect(functionsSource.slice(queueVerificationStart, queueInviteStart)).not.toContain('assertSensitiveEmailVerified');
    expect(functionsSource.slice(redeemInviteStart, redeemHouseholdStart)).toContain('resolveAuthenticatedFamilyInviteEmail({');
    expect(functionsSource.slice(redeemHouseholdStart, redeemCoParentStart)).toContain('resolveAuthenticatedFamilyInviteEmail({');
    expect(functionsSource.slice(redeemCoParentStart, redeemAdminStart)).toContain('resolveAuthenticatedFamilyInviteEmail({');
  });
});
