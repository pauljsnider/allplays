import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readGameHtml() {
    return readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
}

function extractFunctionBody(source, functionName) {
    const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`function ${escapedName}\\(game = \\{\\}\\) \\{([\\s\\S]*?)\\n        \\}`));
    return match ? match[1] : null;
}

describe('game away score view regression', () => {
    it('swaps team-relative scores and result state for away games', () => {
        const source = readGameHtml();
        const functionBody = extractFunctionBody(source, 'resolveGameReportScoreView');

        expect(functionBody).toBeTruthy();

        const resolveGameReportScoreView = new Function('game', functionBody);

        expect(resolveGameReportScoreView({
            isHome: false,
            homeScore: 70,
            awayScore: 55,
            status: 'completed'
        })).toEqual({
            teamScore: 55,
            opponentScore: 70,
            isWin: false,
            isLoss: true,
            isTie: false
        });

        expect(resolveGameReportScoreView({
            isHome: true,
            homeScore: 70,
            awayScore: 55,
            status: 'completed'
        })).toEqual({
            teamScore: 70,
            opponentScore: 55,
            isWin: true,
            isLoss: false,
            isTie: false
        });
    });

    it('uses the team-relative score view for summary prompts and report header', () => {
        const source = readGameHtml();

        expect(source).toContain('const scoreView = resolveGameReportScoreView(game);');
        expect(source).toContain('Final Score: ${scoreView.teamScore} - ${scoreView.opponentScore}');
        expect(source).toContain('const { teamScore, opponentScore, isWin, isLoss, isTie } = scoreView;');
        expect(source).toMatch(/\}\">\$\{teamScore\}<\/div>/);
        expect(source).toMatch(/\}\">\$\{opponentScore\}<\/div>/);
    });
});
