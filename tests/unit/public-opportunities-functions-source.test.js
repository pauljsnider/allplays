import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const firestoreIndexes = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'));
const opportunitySource = source.slice(source.indexOf('// Public sports opportunity board'));
const manageSource = readFileSync(new URL('../../apps/app/src/pages/OpportunityManage.tsx', import.meta.url), 'utf8');

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
      'listManagedTeams',
      'listAuthorizedChatConversations',
      'listParentTeamFeeRecipients',
      'listOfficialLinkedTeamIds',
      'deleteStatConfig',
      'resetTeamStatConfigs',
      'revokeTeamAdminAccess',
      'sendAuthorizedDirectMessage',
      'getPublicTeamProfile',
      'getPublicTeamCalendarProjection',
      'listPublicOpportunityReports',
      'moderatePublicOpportunity'
    ].forEach((name) => expect(source).toContain(`exports.${name}`));
  });

  it('deduplicates public calendar projections against tracked team games before serialization', () => {
    const calendarProjection = source.slice(
      source.indexOf('async function getPublicTeamCalendarTrackingEvents'),
      source.indexOf('exports.getPublicGameProjection')
    );
    expect(calendarProjection).toContain("firestore.collection(`teams/${teamId}/games`)");
    expect(calendarProjection).not.toContain(".where('date'");
    expect(calendarProjection).toContain('orderBy(admin.firestore.FieldPath.documentId())');
    expect(calendarProjection).toContain(".select('calendarEventUid', 'date', 'type', 'location', 'opponent', 'title', 'visibility', 'isPrivate', 'private', 'deleted', 'status', 'liveStatus')");
    expect(calendarProjection).toContain('scanBoundedPublicCalendarTrackingEvents');
    expect(calendarProjection).toContain('maxDocuments: PUBLIC_TEAM_API_MAX_GAME_SCAN_DOCUMENTS');
    expect(calendarProjection).toContain('calendarEventUid: normalizeFamilyShareText(gameSnap.data()?.calendarEventUid)');
    expect(calendarProjection).toContain('type: normalizeFamilyShareText(gameSnap.data()?.type)');
    expect(calendarProjection).toContain('location: normalizeFamilyShareText(gameSnap.data()?.location)');
    expect(calendarProjection).toContain('opponent: normalizeFamilyShareText(gameSnap.data()?.opponent)');
    expect(calendarProjection).toContain('title: normalizeFamilyShareText(gameSnap.data()?.title)');
    expect(calendarProjection).toContain('visibility: normalizeFamilyShareText(gameSnap.data()?.visibility)');
    expect(calendarProjection).toContain('isPrivate: gameSnap.data()?.isPrivate === true');
    expect(calendarProjection).toContain('private: gameSnap.data()?.private === true');
    expect(calendarProjection).toContain('deleted: gameSnap.data()?.deleted === true');
    expect(calendarProjection).toContain('status: normalizeFamilyShareText(gameSnap.data()?.status)');
    expect(calendarProjection).toContain('liveStatus: normalizeFamilyShareText(gameSnap.data()?.liveStatus)');
    expect(calendarProjection).toContain('.filter(canTrackedCalendarEventSuppressPublicProjection)');
    const sourceListIndex = calendarProjection.indexOf('const calendarUrls = []');
    const emptyReturnIndex = calendarProjection.indexOf('if (calendarUrls.length === 0)');
    const trackingScanIndex = calendarProjection.indexOf('const trackedCalendarEvents');
    expect(sourceListIndex).toBeGreaterThan(-1);
    expect(emptyReturnIndex).toBeGreaterThan(sourceListIndex);
    expect(trackingScanIndex).toBeGreaterThan(emptyReturnIndex);
    expect(calendarProjection.slice(emptyReturnIndex, trackingScanIndex)).toContain('events: []');
    expect(calendarProjection.slice(emptyReturnIndex, trackingScanIndex)).toContain('truncated: false');
    expect(calendarProjection.slice(emptyReturnIndex, trackingScanIndex)).toContain('nextCursor: null');
    expect(calendarProjection).toContain('!isFamilyShareCalendarEventTracked(event, trackedCalendarEvents)');
    expect(calendarProjection.indexOf('isFamilyShareCalendarEventTracked'))
      .toBeLessThan(calendarProjection.indexOf('serializePublicCalendarEvent'));
  });

  it('server-verifies publishing roles, verified email, expiration, rate limits, and private notifications', () => {
    expect(source).toContain("context.auth.token?.email_verified !== true");
    expect(source).toContain("const rawEmail = String(context.auth.token?.email || '').trim();");
    expect(source).toContain('hasOpportunityTeamAdminAccess(caller, team)');
    expect(source).toContain('isOpportunityTeamDiscoverable(team)');
    expect(source).toContain("status: 'active'");
    expect(source).toContain('buildOpportunityExpiry(now.toMillis())');
    expect(source).toContain('checkPublicOpportunityBrowseRateLimit');
    expect(source).toContain('checkPublicOpportunityWriteRateLimit');
    expect(source).toContain('checkPublicOpportunityMessageRateLimit');
    expect(source).toContain("appRoute: `/messages?inquiry=${encodeURIComponent(inquiryRef.id)}`");
    expect(source).toContain("appRoute: `/messages?inquiry=${encodeURIComponent(ref.id)}`");
    expect(source).toContain('lastMessagePreview: body');
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

  it('normalizes linked team IDs before every opportunity-side team lookup', () => {
    expect(source).toMatch(/function normalizeOpportunityTeamId\(teamId\)[\s\S]*normalizeFirestoreId\(teamId, 'teamId'\)/);
    expect(source).toContain('teams/${normalizeOpportunityTeamId(input.teamId)}');
    expect(source).toContain('teams/${normalizeOpportunityTeamId(listing.teamId)}');
    expect(opportunitySource).not.toContain('teams/${input.teamId}');
    expect(opportunitySource).not.toContain('teams/${listing.teamId}');
  });

  it('requires verified inquiry senders and allow-lists public team profiles', () => {
    expect(source).toMatch(/createOpportunityInquiry[\s\S]*requireOpportunityAuth\(context, \{ verified: true \}\)/);
    expect(source).toContain('exports.getPublicTeamProfile');
    expect(source).toContain('item = serializePublicTeamProfile(teamSnap.id, team);');
    expect(source).toContain('item = serializeManagedTeamDocument(teamSnap.id, team);');
    expect(source).toContain('return { item };');
  });

  it('routes team inquiries only to current team administrators', () => {
    const resolverStart = source.indexOf('async function resolveOpportunityRecipients(listing)');
    const recipientResolver = source.slice(resolverStart, source.indexOf('\nexports.createOpportunityInquiry', resolverStart));
    expect(recipientResolver).toContain('const recipients = new Set();');
    expect(recipientResolver).toContain('if (team.ownerId) recipients.add(String(team.ownerId));');
    expect(recipientResolver).toContain('getUserIdsByEmails(team.adminEmails || [])');
    expect(recipientResolver).toContain('else if (listing.authorId)');
    expect(recipientResolver).not.toContain('new Set([String(listing.authorId');
  });

  it('authorizes direct messages on the server write path', () => {
    expect(source).toContain('exports.sendAuthorizedDirectMessage');
    expect(source).toContain("conversation.directAccess === 'accepted_friend'");
    expect(source).toContain("conversation.directAccess === 'team_admin'");
    expect(source).toContain('canMessageAcceptedFriendForTeam({');
    expect(source).toContain('hasTeamAdminAccess({');
    expect(source).toContain('initiatorId === callerUid ? callerEmail : recipientEmail');
    expect(source).toContain('admin.auth().getUser(callerUid)');
    expect(source).toContain('admin.auth().getUser(recipientId)');
    expect(source).toContain('userId: recipientId,\n        email: recipientEmail');
    expect(source).toContain('firestore.runTransaction(async (transaction) => {');
    expect(source).toContain('transaction.create(messageRef, message);');
    expect(source).toContain('if (!clientMessageId || !isAlreadyExistsError(error)) throw error;');
    expect(source).toContain('existingMessage.clientMessageId !== clientMessageId');
  });

  it('revokes private team inquiry access and notifications from former administrators', () => {
    expect(source).toMatch(/canAccessOpportunityInquiry[\s\S]*isOpportunityPlatformAdmin\(caller\)[\s\S]*inquiry\.senderId === caller\.uid/);
    expect(source).toMatch(/canAccessOpportunityInquiry[\s\S]*inquiry\.participantIds\.includes\(caller\.uid\)[\s\S]*hasOpportunityTeamAdminAccess/);
    expect(source).toContain('scanned.map((docSnap) => canAccessOpportunityInquiry(caller, docSnap.data() || {}))');
    expect(source).toContain("collectionRef.where('teamId', 'in', teamIds)");
    expect(source).toContain('listOpportunityManagedTeamDocuments(caller)');
    expect(source).toContain('const currentTeamRecipients = inquiry.teamId');
    expect(source).toContain('currentTeamRecipients.has(participantId)');
  });

  it('pages past revoked inquiry rows and requires verified reply authors', () => {
    expect(source).toMatch(/listOpportunityInquiries[\s\S]*const maxScanDocuments = 500/);
    expect(source).toContain('encodeOpportunityInquiryCursor(lastScanned)');
    expect(source).toMatch(/replyToOpportunityInquiry[\s\S]*getOpportunityCaller\(context, \{ verified: true \}\)/);
  });

  it('shows and loads moderation reports only for protected isAdmin accounts', () => {
    expect(manageSource).toContain('const canModerateReports = auth.user?.isAdmin === true;');
    expect(manageSource).toContain('canModerateReports ? listPublicOpportunityReports() : Promise.resolve([])');
    expect(manageSource).not.toContain('auth.user?.isPlatformAdmin');
  });

  it('includes current team-managed listings in management results', () => {
    expect(source).toContain('listOpportunityManagedTeamDocuments(caller)');
    expect(source).toContain(".where('teamId', 'in', managedTeamIds.slice(index, index + 30))");
    expect(source).toContain('managedListingSnaps.forEach');
  });

  it('uses protected legacy coachOf grants only after stale invite evidence is excluded', () => {
    const resolverStart = source.indexOf('async function listStaffTeamDocuments(caller)');
    const resolverSource = source.slice(
      resolverStart,
      source.indexOf('\nexports.revokeTeamAdminAccess', resolverStart)
    );
    const listManagedTeamsSource = source.slice(
      source.indexOf('exports.listManagedTeams'),
      source.indexOf('\nexports.getPublicTeamProfile')
    );

    expect(resolverSource).toContain('caller.user?.coachOf');
    expect(resolverSource).toContain('const legacyCoachTeamLimit = 180;');
    expect(resolverSource).toContain('const coachTeamIdsAreIncomplete = allCoachTeamIds.length > legacyCoachTeamLimit;');
    expect(resolverSource).toContain("firestore.collection('accessCodes')");
    expect(resolverSource).toContain(".where('type', '==', 'admin_invite')");
    expect(resolverSource).not.toContain(".where('usedBy', '==', caller.uid)");
    expect(resolverSource).not.toContain(".where('email', 'in', coachInviteEmailCandidates)");
    expect(resolverSource).toContain(".where('teamId', 'in', teamIds)");
    expect(resolverSource.match(/\.limit\(legacyCoachInviteEvidenceLimit \+ 1\)/g)).toHaveLength(1);
    expect(resolverSource).not.toContain(".where('teamId', '==', teamSnap.id)");
    expect(resolverSource).toContain('result.value.size > legacyCoachInviteEvidenceLimit');
    expect(resolverSource).toContain('if (usedBy === caller.uid)');
    expect(resolverSource).toContain('normalizeStablePrincipalUid(invite.usedBy)');
    expect(resolverSource).not.toContain("String(invite.usedBy || '').trim()");
    expect(resolverSource).toContain('generatedBy is intentionally');
    expect(resolverSource).toContain('teamsWithCallerBoundInviteEvidence.add(teamId)');
    expect(resolverSource).toContain('teamsWithUnresolvedInviteEvidence.add(teamId)');
    expect(resolverSource).toContain('!teamsWithUnresolvedInviteEvidence.has(teamSnap.id)');
    expect(listManagedTeamsSource).toContain('const canManage = hasOpportunityTeamAdminAccess(caller, team);');
    expect(listManagedTeamsSource).toContain('canProjectChatConversation({');
    expect(listManagedTeamsSource).toContain('hasTeamChatAccess: hasCallableChatTeamAccess(caller, teamSnap.id, team)');
    expect(listManagedTeamsSource).toContain('? serializeManagedTeamDocument(teamSnap.id, team)');
    expect(listManagedTeamsSource).toContain(': serializeStaffTeamProfile(teamSnap.id, team)');
  });

  it('serves the bounded dashboard team projection from protected server state', () => {
    const listManagedTeamsSource = source.slice(
      source.indexOf('exports.listManagedTeams'),
      source.indexOf('\nexports.getPublicTeamProfile')
    );

    expect(source).toContain('async function listPlatformAdminTeamDocuments(caller)');
    expect(source).toContain("const snapshot = await firestore.collection('teams')");
    expect(source).toContain('.select(...DASHBOARD_TEAM_FIELD_PATHS)');
    expect(source).toContain('function serializeDashboardManagedTeamProfile(teamId, team = {})');
    const platformAdminTeamSource = source.slice(
      source.indexOf('async function listPlatformAdminTeamDocuments(caller)'),
      source.indexOf('async function listCallableParentTeamDocuments(caller)')
    );
    expect(platformAdminTeamSource).not.toContain(".orderBy('name')");
    expect(source).toContain('async function listCallableParentTeamDocuments(caller)');
    expect(source).toContain("const hasCanonicalTeamIds = Object.prototype.hasOwnProperty.call(user, 'parentTeamIds');");
    expect(source).toContain('hasCanonicalTeamIds && !canonicalTeamIdsAreValid');
    expect(source).toContain('const MAX_DASHBOARD_PARENT_TEAMS = 180;');
    expect(listManagedTeamsSource).toContain('includeAllTeams && !isOpportunityPlatformAdmin(caller)');
    expect(listManagedTeamsSource).toContain('!includeAllTeams && (includeParentTeams || includeChatMetadata)');
    expect(listManagedTeamsSource).toContain('.map((teamSnap) => serializeStaffTeamProfile(teamSnap.id, teamSnap.data() || {}))');
    expect(listManagedTeamsSource).toContain('dashboardTeamLoadVersion: DASHBOARD_TEAM_LOAD_VERSION');
    expect(listManagedTeamsSource).toContain('(includeParentTeams && parentTeamResult.isPartial)');
  });

  it('declares the bounded legacy coach invite-evidence indexes', () => {
    const accessCodeIndexes = firestoreIndexes.indexes.filter((index) => (
      index.collectionGroup === 'accessCodes' && index.queryScope === 'COLLECTION'
    ));
    const fieldSignature = (index) => index.fields
      .map(({ fieldPath, order }) => `${fieldPath}:${order}`)
      .join(',');

    expect(accessCodeIndexes.some((index) => fieldSignature(index) === 'type:ASCENDING,teamId:ASCENDING')).toBe(true);
  });

  it('queries unexpired listings with a bounded, cursor-resumable filtered scan', () => {
    expect(source).toContain(".where('expiresAt', '>', now)");
    expect(source).toContain(".orderBy('expiresAt', 'desc')");
    expect(source).toContain('const maxScanDocuments = 500;');
    expect(source).toContain('scannedDocuments < maxScanDocuments');
    expect(source).toContain('nextCursor: (stoppedBeforeEndOfScan || !exhausted)');
  });

  it('hides inactive detail records from public callers while preserving manager access', () => {
    expect(source).toMatch(/getPublicOpportunity[\s\S]*getEffectiveOpportunityStatus\(listing\) !== 'active'/);
    expect(source).toMatch(/getPublicOpportunity[\s\S]*!context\.auth\?\.uid[\s\S]*Opportunity not found/);
    expect(source).toMatch(/getPublicOpportunity[\s\S]*canManageOpportunity\(caller, listing\)/);
  });
});
