import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('scorekeeping access wiring', () => {
    it('wires Game Day to limited scorekeeping access instead of full admin only', () => {
        const source = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

        expect(source).toContain("['full', 'scorekeep', 'stream', 'stream-score', 'videographer'].includes(accessInfo.accessLevel)");
        expect(source).toContain("accessInfo.accessLevel === 'stream-score'");
        expect(source).toContain('renderLimitedStreamAndScoreAccess(accessInfo)');
        expect(source).toContain("accessInfo.accessLevel === 'scorekeep'");
        expect(source).toContain('renderLimitedScorekeepingAccess(accessInfo)');
        expect(source).toContain("accessInfo.accessLevel === 'videographer'");
        expect(source).toContain('renderLimitedVideographerAccess(accessInfo)');
        expect(source).toContain("if (accessInfo.accessLevel !== 'full')");
        expect(source).toContain('subscribeToGameUpdates({ fullAccess: true })');
        expect(source).toContain('if (!fullAccess)');
        expect(source).toContain('Roster management, schedule editing, team settings, and other coach/admin controls remain restricted.');

        const workflow = readFileSync(resolve(process.cwd(), 'workflow-track-game.html'), 'utf8');
        expect(workflow).toContain('approved scorekeeper for the scheduled game');
        expect(workflow).toContain('do not receive roster, schedule, or team settings access');
        expect(workflow).toContain('<strong>Delegated scorekeeper</strong>: Open the scheduled game in <strong>Game Day</strong> and select <strong>Open scorekeeper</strong>');
        expect(workflow).toContain('Scorekeeping access does not include the Schedule page.');
        expect(workflow).toContain('<strong>Coach or admin</strong>: Open the game from Schedule and select <strong>Track</strong>');
        expect(workflow).not.toContain('<li>Open the game from schedule.</li>');

        const appHelpIndex = readFileSync(resolve(process.cwd(), 'apps/app/src/lib/helpKnowledgeIndex.ts'), 'utf8');
        expect(appHelpIndex).toContain('Delegated scorekeeper : Open the scheduled game in Game Day and select Open scorekeeper');
        expect(appHelpIndex).toContain('Scorekeeping access does not include the Schedule page.');

        const workflowManifest = JSON.parse(readFileSync(resolve(process.cwd(), 'workflow-manifest.json'), 'utf8'));
        const trackGameSearchText = workflowManifest.find((item) => item.file === 'workflow-track-game.html')?.searchText;
        expect(trackGameSearchText).toContain('Open scorekeeper');
        expect(trackGameSearchText).toContain('Scorekeeping access does not include the Schedule page.');
    });

    it('gates both live scoring trackers with scorekeeping access', () => {
        const standardTracker = readFileSync(resolve(process.cwd(), 'track.html'), 'utf8');
        const basketballTracker = readFileSync(resolve(process.cwd(), 'js/track-basketball.js'), 'utf8');

        expect(standardTracker).toContain("import { hasScorekeepingTeamAccess } from './js/team-access.js?v=44338';");
        expect(standardTracker).toContain('hasScorekeepingTeamAccess(currentUser, { ...team, id: teamId }, game, scorekeepingRsvp)');
        expect(basketballTracker).toContain("import { hasScorekeepingTeamAccess } from './team-access.js?v=44338';");
        expect(basketballTracker).toContain('hasScorekeepingTeamAccess(currentUser, { ...team, id: teamId }, game, scorekeepingRsvp)');
    });

    it('allows scoped scorekeeper writes in Firestore rules without opening roster or schedule writes', () => {
        const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
        const gameRulesStart = rules.indexOf('match /games/{gameId} {');
        const gameRulesEnd = rules.indexOf('match /liveChat/{messageId} {', gameRulesStart);
        const gameRules = rules.slice(gameRulesStart, gameRulesEnd);
        const eventsRule = gameRules.match(/match \/events\/\{eventId\} \{[\s\S]*?\n        \}/)?.[0] || '';
        const aggregatedStatsRule = gameRules.match(/match \/aggregatedStats\/\{statId\} \{[\s\S]*?\n        \}/)?.[0] || '';
        const teamStatsRule = gameRules.match(/match \/teamStats\/\{statId\} \{[\s\S]*?\n        \}/)?.[0] || '';
        const privatePlayerStatsRule = gameRules.match(/match \/privatePlayerStats\/\{statId\} \{[\s\S]*?\n        \}/)?.[0] || '';
        const liveEventsRule = gameRules.match(/match \/liveEvents\/\{eventId\} \{[\s\S]*?\n        \}/)?.[0] || '';

        expect(rules).toContain('function canScorekeepGame(teamId, gameId)');
        expect(rules).toContain('allow update: if isScorekeepingGameUpdate(teamId, gameId);');
        expect(rules).toMatch(/allow update: if !isDiamondProtectedGameMutation\(\) &&\s+!isBroadcastSessionOnlyUpdate\(\) &&\s+!isReplayArchiveMutation\(\) &&\s+\(isTeamOwnerOrAdmin\(teamId\) \|\|\s+\(isOfficialForGame\(\) && isOfficialGameUpdate\(\)\) \|\|\s+isVideographyGameUpdate\(teamId, gameId\)\);/);
        expect(rules).toContain('allow update: if isReplayArchiveOnlyUpdate() &&');
        expect(rules).toContain('allow update: if isStreamingGameUpdate(teamId, gameId);');
        for (const legacyProjectionRule of [eventsRule, aggregatedStatsRule, teamStatsRule]) {
            expect(legacyProjectionRule).toContain('allow create, update: if !gameUsesDiamondScorebook(teamId, gameId) &&');
            expect(legacyProjectionRule).toContain('(isTeamOwnerOrAdmin(teamId) || canScorekeepGame(teamId, gameId));');
        }
        expect(privatePlayerStatsRule).toContain('allow create, update, delete: if !gameUsesDiamondScorebook(teamId, gameId) &&');
        expect(privatePlayerStatsRule).toContain('(isTeamOwnerOrAdmin(teamId) || canScorekeepGame(teamId, gameId));');
        expect(eventsRule).toContain('allow delete: if !gameUsesDiamondScorebook(teamId, gameId) && isTeamOwnerOrAdmin(teamId);');
        expect(aggregatedStatsRule).toMatch(/allow delete: if !gameUsesDiamondScorebook\(teamId, gameId\) &&\s+isTeamOwnerOrAdmin\(teamId\);/);
        expect(teamStatsRule).toMatch(/allow delete: if !gameUsesDiamondScorebook\(teamId, gameId\) &&\s+isTeamOwnerOrAdmin\(teamId\);/);
        expect(teamStatsRule).toContain('allow read: if !gameUsesDiamondScorebook(teamId, gameId) &&');
        expect(privatePlayerStatsRule).toContain('allow read: if !gameUsesDiamondScorebook(teamId, gameId) &&');
        expect(liveEventsRule).toContain('allow create: if !gameUsesDiamondScorebook(teamId, gameId) &&');
        expect(liveEventsRule).toContain('hasValidLiveEventAttribution(request.resource.data)');
        expect(liveEventsRule).toContain("data.createdBy == request.auth.uid");
        expect(liveEventsRule).toContain("data.actorUid == request.auth.uid");
    });
});
