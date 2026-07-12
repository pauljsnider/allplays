import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('public opportunity callable wiring', () => {
  it('exports public browse, lifecycle, inquiry, and moderation contracts', () => {
    [
      'listPublicOpportunities',
      'getPublicOpportunity',
      'createPublicOpportunity',
      'updatePublicOpportunity',
      'closePublicOpportunity',
      'renewPublicOpportunity',
      'reportPublicOpportunity',
      'createOpportunityInquiry',
      'replyToOpportunityInquiry',
      'listOpportunityInquiries',
      'getOpportunityInquiry',
      'listMyPublicOpportunities',
      'listManagedPublicOpportunityTeams',
      'getPublicTeamProfile',
      'listPublicOpportunityReports',
      'moderatePublicOpportunity'
    ].forEach((name) => expect(source).toContain(`exports.${name}`));
  });

  it('server-verifies publishing roles, verified email, expiration, rate limits, and private notifications', () => {
    expect(source).toContain("context.auth.token?.email_verified !== true");
    expect(source).toContain('hasTeamAdminAccess({ team, user: caller.user, uid: caller.uid, email: caller.email })');
    expect(source).toContain("team.isPublic !== true");
    expect(source).toContain("team.active === false");
    expect(source).toContain("status: 'active'");
    expect(source).toContain('buildOpportunityExpiry(now.toMillis())');
    expect(source).toContain('checkPublicOpportunityBrowseRateLimit');
    expect(source).toContain('checkPublicOpportunityWriteRateLimit');
    expect(source).toContain('checkPublicOpportunityMessageRateLimit');
    expect(source).toContain("appRoute: `/discover/inquiries/${inquiryRef.id}`");
    expect(source).toContain('writeNotificationInboxRecords({');
  });

  it('closes linked opportunities when a team stops being public', () => {
    expect(source).toContain('exports.closePublicOpportunitiesForPrivateTeam');
    expect(source).toContain("closedReason: 'team_not_public'");
  });

  it('prevents authors from reviving moderated or no-longer-authorized team listings', () => {
    expect(source).toMatch(/setOpportunityLifecycleStatus[\s\S]*listing\.status === 'removed'[\s\S]*can only be restored by a platform admin/);
    expect(source).toContain("mode === 'renew' && listing.kind !== 'player_seeking_team'");
    expect(source).toContain('await resolveOpportunityTeam({ kind: listing.kind, teamId: listing.teamId }, caller);');
    expect(source).toContain("action === 'restore' && listing.kind !== 'player_seeking_team'");
    expect(source).toContain('The linked team must be active and public before this listing can be restored.');
  });

  it('requires verified inquiry senders and allow-lists public team profiles', () => {
    expect(source).toMatch(/createOpportunityInquiry[\s\S]*requireOpportunityAuth\(context, \{ verified: true \}\)/);
    expect(source).toContain('exports.getPublicTeamProfile');
    expect(source).toContain("description: cleanOpportunityText(team.description, 1000) || null");
  });
});
