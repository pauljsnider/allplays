import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function readFirestoreIndexes() {
    return JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'));
}

function getFunctionSource(source, functionName) {
    const start = source.indexOf(`export async function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = source.indexOf('\nexport async function ', start + 1);
    return source.slice(start, nextExport === -1 ? source.length : nextExport);
}

describe('homepage shared game discovery queries', () => {
    it('includes sharedGames in live, upcoming, and replay homepage discovery', () => {
        const source = readDbSource();

        expect(source).toContain("collectionGroup(db, 'sharedGames')");
        expect(source).toContain('projectSharedGameForTeam(sharedGame, teamId)');
        expect(source).toContain('const team = await getTeam(teamId, { includeInactive: true });');

        const upcomingSource = getFunctionSource(source, 'getUpcomingLiveGames');
        expect(upcomingSource).toContain('getSharedHomepageGames');
        expect(upcomingSource).toContain('shouldIncludeTeamInLiveOrUpcoming');
        expect(upcomingSource).toContain('games.sort(compareGamesByDateAsc)');
        expect(upcomingSource).toContain('isExcludedHomepageUpcomingStatus(gameData.status)');
        expect(upcomingSource).toContain('isExcludedHomepageUpcomingStatus(game.status)');
        expect(upcomingSource).not.toContain("where('type', '==', 'game')");
        expect(upcomingSource).toContain("if (!gameData.type) {");
        expect(upcomingSource).toContain("gameData.type = 'game';");
        expect(source).toContain("normalizedStatus === 'canceled'");
        expect(source).toContain("normalizedStatus === 'deleted'");

        const liveSource = getFunctionSource(source, 'getLiveGamesNow');
        expect(liveSource).toContain('getSharedHomepageGames');
        expect(liveSource).toContain("where('liveStatus', '==', 'live')");
        expect(liveSource).toContain('shouldIncludeTeamInLiveOrUpcoming');
        expect(liveSource).toContain('isExcludedHomepageUpcomingStatus(gameData.status)');
        expect(liveSource).toContain('sharedGames.filter(game => !isExcludedHomepageUpcomingStatus(game.status))');

        const replaySource = getFunctionSource(source, 'getRecentLiveTrackedGames');
        expect(replaySource).toContain('getSharedHomepageGames(recentQueryConstraints, shouldIncludeTeamInReplay, limitCount)');
        expect(replaySource).toContain('games.sort(compareGamesByDateDesc)');
        expect(replaySource).toContain('return games.slice(0, limitCount)');
    });

    it('declares homepage collection group indexes for shared and team game date queries', () => {
        const indexConfig = readFirestoreIndexes();
        const sharedGameIndexes = indexConfig.indexes
            .filter((index) => index.collectionGroup === 'sharedGames')
            .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order || field.arrayConfig}`).join(','));
        const dateFieldOverrides = indexConfig.fieldOverrides
            .filter((override) => override.fieldPath === 'date')
            .map((override) => ({
                collectionGroup: override.collectionGroup,
                indexes: override.indexes.map((index) => `${index.order}:${index.queryScope}`)
            }));
        const sharedMembershipFieldOverrides = indexConfig.fieldOverrides
            .filter((override) => (
                override.collectionGroup === 'sharedGames'
                && ['homeTeamId', 'awayTeamId'].includes(override.fieldPath)
            ))
            .map((override) => ({
                fieldPath: override.fieldPath,
                indexes: override.indexes.map((index) => `${index.order}:${index.queryScope}`)
            }));

        expect(sharedGameIndexes).toContain('type:ASCENDING,date:ASCENDING');
        expect(sharedGameIndexes).toContain('liveStatus:ASCENDING,date:DESCENDING');
        expect(sharedGameIndexes).toContain('homeTeamId:ASCENDING,date:ASCENDING');
        expect(sharedGameIndexes).toContain('awayTeamId:ASCENDING,date:ASCENDING');
        expect(sharedGameIndexes).toContain('teamIds:CONTAINS,date:ASCENDING');
        expect(dateFieldOverrides).toContainEqual({
            collectionGroup: 'games',
            indexes: ['ASCENDING:COLLECTION_GROUP', 'DESCENDING:COLLECTION_GROUP']
        });
        expect(dateFieldOverrides).toContainEqual({
            collectionGroup: 'sharedGames',
            indexes: ['ASCENDING:COLLECTION_GROUP', 'DESCENDING:COLLECTION_GROUP']
        });
        expect(sharedMembershipFieldOverrides).toEqual([
            {
                fieldPath: 'homeTeamId',
                indexes: [
                    'ASCENDING:COLLECTION',
                    'DESCENDING:COLLECTION',
                    'ASCENDING:COLLECTION_GROUP'
                ]
            },
            {
                fieldPath: 'awayTeamId',
                indexes: [
                    'ASCENDING:COLLECTION',
                    'DESCENDING:COLLECTION',
                    'ASCENDING:COLLECTION_GROUP'
                ]
            }
        ]);
    });

    it('clears live broadcast state when a legacy schedule game is cancelled', () => {
        const cancelSource = getFunctionSource(readDbSource(), 'cancelGame');

        expect(cancelSource).toContain("status: 'cancelled'");
        expect(cancelSource).toContain("liveStatus: 'cancelled'");
    });
});
