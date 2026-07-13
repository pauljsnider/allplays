import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const collectionGroupGamesHelperMatch = rules.match(/function canReadCollectionGroupGameDocument\(teamPath, data\) \{[\s\S]*?\n\s*}/);
const collectionGroupGamesHelper = collectionGroupGamesHelperMatch?.[0] || '';
const collectionGroupGamesMatch = rules.match(/match \/\{path=\*\*}\/games\/\{gameId} \{[\s\S]*?\n\s*}/);
const collectionGroupGamesRules = collectionGroupGamesMatch?.[0] || '';
const collectionGroupSharedGamesHelperMatch = rules.match(/function canReadCollectionGroupSharedGameDocument\(data\) \{[\s\S]*?\n\s*}/);
const collectionGroupSharedGamesHelper = collectionGroupSharedGamesHelperMatch?.[0] || '';
const collectionGroupSharedGamesMatch = rules.match(/match \/\{path=\*\*}\/sharedGames\/\{gameId} \{[\s\S]*?\n\s*}/);
const collectionGroupSharedGamesRules = collectionGroupSharedGamesMatch?.[0] || '';
const sharedGamesSubcollectionMatch = rules.match(/match \/\{path=\*\*}\/sharedGames\/\{gameId}\/\{liveGameCollection}\/\{docId} \{[\s\S]*?\n\s*}/);
const sharedGamesSubcollectionRules = sharedGamesSubcollectionMatch?.[0] || '';
const teamGamesStart = rules.indexOf('match /games/{gameId} {');
const teamGamesEnd = rules.indexOf('// Live Events subcollection - for real-time game broadcasting', teamGamesStart);
const teamGamesRules = teamGamesStart === -1 || teamGamesEnd === -1
    ? ''
    : rules.slice(teamGamesStart, teamGamesEnd);
const eventsMatch = teamGamesRules.match(/match \/events\/\{eventId} \{[\s\S]*?\n\s*}/);
const aggregatedStatsMatch = teamGamesRules.match(/match \/aggregatedStats\/\{statId} \{[\s\S]*?\n\s*}/);
const eventsRules = eventsMatch?.[0] || '';
const aggregatedStatsRules = aggregatedStatsMatch?.[0] || '';

describe('game Firestore read rules', () => {
    it('keeps staff assignment-array updates on the team-admin game write path', () => {
        expect(teamGamesRules).toContain('allow update: if !isBroadcastSessionOnlyUpdate() &&');
        expect(teamGamesRules).toContain('(isTeamOwnerOrAdmin(teamId) ||');
        expect(teamGamesRules).toContain('allow update: if isBroadcastSessionOnlyUpdate() && isTeamOwnerOrAdmin(teamId);');
    });

    it('replaces unconditional game reads with shared visibility helpers', () => {
        expect(rules).toContain('function canReadGameDocument(teamId, gameId, data)');
        expect(rules).toContain('function canReadGameSubcollectionDocument(teamId, gameId)');
        expect(rules).toContain('function canReadCollectionGroupGameDocument(teamPath, data)');
        expect(rules).toContain('function canReadManagedTeamDocument(data)');
        expect(rules).toContain('function canReadPublicGameDocument(teamData, data)');
        expect(teamGamesRules).toContain('allow read: if canReadGameDocument(teamId, gameId, resource.data);');
        expect(eventsRules).toContain('allow read: if canReadGameSubcollectionDocument(teamId, gameId);');
        expect(aggregatedStatsRules).toContain('allow read: if canReadGameSubcollectionDocument(teamId, gameId);');
        expect(collectionGroupGamesRules).toContain('allow read: if canReadCollectionGroupGameDocument(path, resource.data);');
        expect(teamGamesRules).not.toContain('allow read: if true;');
        expect(collectionGroupGamesRules).not.toContain('allow read: if true;');
        expect(eventsRules).not.toContain('allow read: if true;');
        expect(aggregatedStatsRules).not.toContain('allow read: if true;');
    });

    it('keeps private-team private games unreadable to outsiders while allowing public or shareable games', () => {
        expect(rules).toContain("data.get('type', 'game') == 'game'");
        expect(rules).toContain("data.get('visibility', '') != 'private'");
        expect(rules).toContain("data.get('isPrivate', false) != true");
        expect(rules).toContain("data.get('private', false) != true");
        expect(rules).toContain("data.get('status', '') != 'deleted'");
        expect(rules).toContain("data.get('liveStatus', '') != 'deleted'");
        expect(rules).toContain("isPublicGameReadTeam(teamData) || isShareableGameDocument(data)");
        expect(rules).toContain("data.get('shareable', false) == true");
        expect(rules).toContain("data.get('publicCalendar', false) == true");
        expect(collectionGroupGamesHelper).toContain('let parentTeamPath = /databases/$(database)/documents/$(teamPath);');
        expect(collectionGroupGamesHelper).toContain('let parentTeam = get(parentTeamPath).data;');
        expect(collectionGroupGamesHelper).toContain('return parentTeam != null &&');
        expect(collectionGroupGamesHelper).toContain('canReadManagedTeamDocument(parentTeam)');
        expect(collectionGroupGamesHelper).toContain('canReadPublicGameDocument(parentTeam, data)');
        expect(collectionGroupGamesHelper).not.toContain('canReadManagedTeamDocument(get(/databases/$(database)/documents/$(teamPath)).data)');
        expect(collectionGroupGamesHelper).not.toContain('canReadPublicGameDocument(get(/databases/$(database)/documents/$(teamPath)).data, data)');
        expect(collectionGroupGamesHelper.match(/get\(parentTeamPath\)/g) || []).toHaveLength(1);
        expect(collectionGroupGamesHelper).not.toContain('exists(parentTeamPath)');
        expect(rules).not.toContain('canReadTeamDocument(get(/databases/$(database)/documents/$(teamPath)).data)');
    });

    it('preserves signed-in access for team staff, parents, scoped helpers, and officials', () => {
        expect(rules).toContain('isTeamOwnerOrAdmin(teamId)');
        expect(rules).toContain('isParentForTeam(teamId)');
        expect(rules).toContain('canScorekeepGame(teamId, gameId)');
        expect(rules).toContain('canVideographGame(teamId, gameId)');
        expect(rules).toContain('isAuthorizedOfficialForGame(data)');
        expect(rules).toContain("request.auth.uid in data.get('officiatingAuthorizedUserIds', [])");
    });

    it('allows sharedGames collection-group reads through referenced team visibility only', () => {
        expect(rules).toContain('function canReadSharedGameForExistingTeam(data, teamId)');
        expect(rules).toContain('function canReadSharedGameForTeamId(data, teamId)');
        expect(rules).toContain('function canReadCollectionGroupSharedGameDocument(data)');
        expect(rules).toContain('function canReadSharedGameSubcollectionDocument(sharedGamePath)');
        expect(collectionGroupSharedGamesRules).toContain('allow read: if canReadCollectionGroupSharedGameDocument(resource.data);');
        expect(collectionGroupSharedGamesRules).not.toContain('allow read: if true;');
        expect(collectionGroupSharedGamesHelper).toContain("canReadSharedGameForTeamId(data, data.get('homeTeamId', null))");
        expect(collectionGroupSharedGamesHelper).toContain("canReadSharedGameForTeamId(data, data.get('awayTeamId', null))");
        expect(sharedGamesSubcollectionRules).toContain("liveGameCollection in [");
        expect(sharedGamesSubcollectionRules).toContain("'events'");
        expect(sharedGamesSubcollectionRules).toContain("'aggregatedStats'");
        expect(sharedGamesSubcollectionRules).toContain("'liveEvents'");
        expect(sharedGamesSubcollectionRules).toContain("'liveChat'");
        expect(sharedGamesSubcollectionRules).toContain("'liveReactions'");
        expect(sharedGamesSubcollectionRules).toContain('canReadSharedGameSubcollectionDocument(');
        expect(sharedGamesSubcollectionRules).toContain('/databases/$(database)/documents/$(path)/sharedGames/$(gameId)');
        expect(sharedGamesSubcollectionRules).not.toContain('allow read: if true;');
        expect(rules).toContain('canReadPublicGameDocument(teamData, data)');
        expect(rules).toContain('isTeamOwnerOrAdmin(teamId) ||');
        expect(rules).toContain('isParentForTeam(teamId) ||');
    });
});
