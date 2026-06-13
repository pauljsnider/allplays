import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');

describe('Game Hub lazy panel mounting', () => {
    it('declares a mountedPanels Set initialized with only the primary panel', () => {
        expect(source).toContain("useState<Set<string>>(() => new Set(['primary']))");
    });

    it('uses IntersectionObserver-driven lazy mounting instead of mounting every panel in an empty effect', () => {
        expect(source).toContain('function LazyMountSection');
        expect(source).toContain('new window.IntersectionObserver');
        expect(source).not.toContain("setMountedPanels(new Set([");
    });

    it('keeps each heavy panel behind LazyMountSection wrappers', () => {
        expect(source).toMatch(/panelKey="scoring"[\s\S]*LiveGameClockPanel[\s\S]*LiveScoreEditor[\s\S]*GameDayFoulTrackerPanel/);
        expect(source).toMatch(/panelKey="reactions"[\s\S]*LiveGameReactionsPanel/);
        expect(source).toMatch(/panelKey="chat"[\s\S]*LiveGameChatPanel/);
        expect(source).toMatch(/panelKey="wrapup"[\s\S]*GameWrapupPanel/);
        expect(source).toMatch(/panelKey="statsheet"[\s\S]*StatsheetImportPanel/);
        expect(source).toMatch(/panelKey="lineup"[\s\S]*GameHubLineupBuilderPanel/);
        expect(source).toMatch(/panelKey="substitution"[\s\S]*GameDaySubstitutionPanel/);
        expect(source).toMatch(/panelKey="report"[\s\S]*GameReportSections/);
    });
});
