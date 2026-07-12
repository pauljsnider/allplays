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
    expect(source).toContain('isOpportunityTeamDiscoverable(team)');
    expect(source).toContain("status: 'active'");
    expect(source).toContain('buildOpportunityExpiry(now.toMillis())');
    expect(source).toContain('checkPublicOpportunityBrowseRateLimit');
    expect(source).toContain('checkPublicOpportunityWriteRateLimit');
    expect(source).toContain('checkPublicOpportunityMessageRateLimit');
    expect(source).toContain("appRoute: `/discover/inquiries/${inquiryRef.id}`");
    expect(source).toContain('writeNotificationInboxRecords({');
  });

  it('uses only protected global-admin state for opportunity moderation authority', () => {
    const adminCheck = source.match(/function isOpportunityPlatformAdmin\(caller\) \{[\s\S]*?\n\}/)?.[0] || '';
    expect(adminCheck).toContain('caller?.user?.isAdmin === true');
    expect(adminCheck).not.toContain('isPlatformAdmin');
    expect(adminCheck).not.toContain('roles');
  });

  it('closes linked opportunities when a team stops being public', () => {
    expect(source).toContain('exports.closePublicOpportunitiesForPrivateTeam');
    expect(source).toContain("closedReason: 'team_not_public'");
  });

  it('prevents authors from reviving moderated or no-longer-authorized team listings', () => {
    expect(source).toMatch(/setOpportunityLifecycleStatus[\s\S]*listing\.status === 'removed'[\s\S]*can only be restored by a platform admin/);
    expect(source).toContain("mode === 'renew' && listing.kind !== 'player_seeking_team'");
    expect(source).toContain('await resolveOpportunityTeam({ kind: listing.kind, teamId: listing.teamId }, caller);');
    expect(source).toContain("restoringRemovedListing && listing.kind !== 'player_seeking_team'");
    expect(source).toContain('The linked team must be active and public before this listing can be restored.');
  });

  it('preserves owner lifecycle state when reports are dismissed', () => {
    expect(source).toContain("const restoringRemovedListing = action === 'restore' && listing.status === 'removed'");
    expect(source).toMatch(/restoringRemovedListing[\s\S]*\? \{ status: 'active', expiresAt:[\s\S]*: \{ moderatedBy:/);
  });

  it('uses full active-team semantics for publishing, profiles, restoration, and automatic closure', () => {
    expect(source).toContain('isOpportunityTeamDiscoverable,');
    expect(source).toMatch(/resolveOpportunityTeam[\s\S]*!isOpportunityTeamDiscoverable\(team\)/);
    expect(source).toContain('const wasDiscoverable = isOpportunityTeamDiscoverable(before);');
    expect(source).toContain('const isDiscoverable = isOpportunityTeamDiscoverable(after);');
  });

  it('requires verified inquiry senders and allow-lists public team profiles', () => {
    expect(source).toMatch(/createOpportunityInquiry[\s\S]*requireOpportunityAuth\(context, \{ verified: true \}\)/);
    expect(source).toContain('exports.getPublicTeamProfile');
    expect(source).toContain("description: cleanOpportunityText(team.description, 1000) || null");
  });

  it('includes current team-managed listings in management results', () => {
    expect(source).toContain('listOpportunityManagedTeamDocuments(caller)');
    expect(source).toContain(".where('teamId', 'in', managedTeamIds.slice(index, index + 30))");
    expect(source).toContain('managedListingSnaps.forEach');
  });

  it('queries unexpired listings and scans filtered pages through exhaustion', () => {
    expect(source).toContain(".where('expiresAt', '>', now)");
    expect(source).toContain(".orderBy('expiresAt', 'desc')");
    expect(source).toContain('while (items.length < pageSize && !exhausted)');
    expect(source).not.toContain('page < 5 && items.length < pageSize');
  });

  it('hides inactive detail records from public callers while preserving manager access', () => {
    expect(source).toMatch(/getPublicOpportunity[\s\S]*getEffectiveOpportunityStatus\(listing\) !== 'active'/);
    expect(source).toMatch(/getPublicOpportunity[\s\S]*!context\.auth\?\.uid[\s\S]*Opportunity not found/);
    expect(source).toMatch(/getPublicOpportunity[\s\S]*canManageOpportunity\(caller, listing\)/);
  });
});
