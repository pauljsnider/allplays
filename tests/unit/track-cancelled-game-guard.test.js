import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTrackPage() {
    return readFileSync(new URL('../../track.html', import.meta.url), 'utf8');
}

function readBetaBasketballTracker() {
    return readFileSync(new URL('../../js/track-basketball.js', import.meta.url), 'utf8');
}

describe('standard tracker cancelled game guard', () => {
    it('blocks cancelled games during tracker initialization', () => {
        const source = readTrackPage();

        expect(source).toContain('function isCancelledGame(game)');
        expect(source).toContain("return status === 'cancelled' || status === 'canceled';");
        expect(source).toContain('if (isCancelledGame(game))');
        expect(source).toContain('Cancelled games cannot be tracked. Restore or reschedule the game before tracking.');
        expect(source).toContain('window.location.href = `edit-schedule.html#teamId=${teamId}`;');
    });

    it('re-checks cancellation before Save & Complete writes completed status', () => {
        const source = readTrackPage();
        const latestGameGuardIndex = source.indexOf('const latestGame = await getGame(currentTeamId, currentGameId);');
        const finishWriteIndex = source.indexOf('await commitStandardTrackerFinishData({');

        expect(latestGameGuardIndex).toBeGreaterThan(-1);
        expect(finishWriteIndex).toBeGreaterThan(-1);
        expect(latestGameGuardIndex).toBeLessThan(finishWriteIndex);
        expect(source).toContain('if (isCancelledGame(latestGame || currentGame))');
        expect(source).toContain('Cancelled games cannot be completed. Restore or reschedule the game before saving stats.');
    });
});

describe('beta basketball tracker cancelled game guard', () => {
    it('blocks cancelled games during tracker initialization', () => {
        const source = readBetaBasketballTracker();

        expect(source).toContain('function isCancelledGame(game)');
        expect(source).toContain("return status === 'cancelled' || status === 'canceled';");
        expect(source).toContain('if (isCancelledGame(game))');
        expect(source).toContain('Cancelled games cannot be tracked. Restore or reschedule the game before tracking.');
        expect(source).toContain('window.location.href = `edit-schedule.html#teamId=${teamId}`;');
    });

    it('re-checks cancellation before Save & Complete writes completed status', () => {
        const source = readBetaBasketballTracker();
        const saveAndCompleteIndex = source.indexOf('async function saveAndComplete()');
        const latestGameGuardIndex = source.indexOf('const latestGame = await getGame(currentTeamId, currentGameId);', saveAndCompleteIndex);
        const finishWriteIndex = source.indexOf('await commitStandardTrackerFinishData({', saveAndCompleteIndex);

        expect(saveAndCompleteIndex).toBeGreaterThan(-1);
        expect(latestGameGuardIndex).toBeGreaterThan(saveAndCompleteIndex);
        expect(finishWriteIndex).toBeGreaterThan(saveAndCompleteIndex);
        expect(latestGameGuardIndex).toBeLessThan(finishWriteIndex);
        expect(source).toContain('if (isCancelledGame(latestGame || currentGame))');
        expect(source).toContain('Cancelled games cannot be completed. Restore or reschedule the game before saving stats.');
    });
});
