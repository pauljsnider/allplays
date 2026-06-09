import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const collectionGroupGamesMatch = rules.match(/match \/{path=\*\*}\/games\/\{gameId} \{[\s\S]*?\n\s*}/);
const collectionGroupGamesRules = collectionGroupGamesMatch?.[0] || '';
const teamGamesStart = rules.indexOf('match /games/{gameId} {');
const teamGamesEnd = rules.indexOf('// Events subcollection', teamGamesStart);
const teamGamesRules = teamGamesStart === -1 || teamGamesEnd === -1
    ? ''
    : rules.slice(teamGamesStart, teamGamesEnd);

describe('game Firestore read rules', () => {
    it('replaces unconditional game reads with shared visibility helpers', () => {
        expect(rules).toContain('function canReadGameDocument(teamId, gameId, data)');
        expect(rules).toContain('function canReadCollectionGroupGameDocument(teamPath, data)');
        expect(rules).toContain('function canReadPublicGameDocument(teamData, data)');
        expect(teamGamesRules).toContain('allow read: if canReadGameDocument(teamId, gameId, resource.data);');
        expect(collectionGroupGamesRules).toContain('allow read: if canReadCollectionGroupGameDocument(path, resource.data);');
        expect(teamGamesRules).not.toContain('allow read: if true;');
        expect(collectionGroupGamesRules).not.toContain('allow read: if true;');
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
    });

    it('preserves signed-in access for team staff, parents, scoped helpers, and officials', () => {
        expect(rules).toContain('isTeamOwnerOrAdmin(teamId)');
        expect(rules).toContain('isParentForTeam(teamId)');
        expect(rules).toContain('canScorekeepGame(teamId, gameId)');
        expect(rules).toContain('canVideographGame(teamId, gameId)');
        expect(rules).toContain('isAuthorizedOfficialForGame(data)');
        expect(rules).toContain("request.auth.uid in data.get('officiatingAuthorizedUserIds', [])");
    });
});
