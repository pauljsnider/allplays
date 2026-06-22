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
        expect(source).toContain('Roster management, schedule editing, team settings, and other coach/admin controls remain restricted.');

        const workflow = readFileSync(resolve(process.cwd(), 'workflow-track-game.html'), 'utf8');
        expect(workflow).toContain('approved scorekeeper for the scheduled game');
        expect(workflow).toContain('do not receive roster, schedule, or team settings access');
    });

    it('gates both live scoring trackers with scorekeeping access', () => {
        const standardTracker = readFileSync(resolve(process.cwd(), 'track.html'), 'utf8');
        const basketballTracker = readFileSync(resolve(process.cwd(), 'js/track-basketball.js'), 'utf8');

        expect(standardTracker).toContain("import { hasScorekeepingTeamAccess } from './js/team-access.js?v=2';");
        expect(standardTracker).toContain('hasScorekeepingTeamAccess(currentUser, { ...team, id: teamId }, game, scorekeepingRsvp)');
        expect(basketballTracker).toContain("import { hasScorekeepingTeamAccess } from './team-access.js?v=2';");
        expect(basketballTracker).toContain('hasScorekeepingTeamAccess(currentUser, { ...team, id: teamId }, game, scorekeepingRsvp)');
    });

    it('allows scoped scorekeeper writes in Firestore rules without opening roster or schedule writes', () => {
        const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

        expect(rules).toContain('function canScorekeepGame(teamId, gameId)');
        expect(rules).toMatch(/allow update: if isTeamOwnerOrAdmin\(teamId\) \|\|\s+\(isOfficialForGame\(\) && isOfficialGameUpdate\(\)\) \|\|\s+isScorekeepingGameUpdate\(teamId, gameId\) \|\|\s+isVideographyGameUpdate\(teamId, gameId\);/);
        expect(rules).toContain('allow create, update: if isTeamOwnerOrAdmin(teamId) || canScorekeepGame(teamId, gameId);');
        const privatePlayerStatsRule = rules.match(/match \/privatePlayerStats\/\{statId\} \{[\s\S]*?\n        \}/)?.[0] || '';
        expect(privatePlayerStatsRule).toContain('allow read, create, update: if isTeamOwnerOrAdmin(teamId) || canScorekeepGame(teamId, gameId);');
        expect(privatePlayerStatsRule).toContain('allow delete: if isTeamOwnerOrAdmin(teamId) || canScorekeepGame(teamId, gameId);');
    });
});
