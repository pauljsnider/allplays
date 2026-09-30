import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../game-day.html', import.meta.url), 'utf8');
const scheduleSource = readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');

describe('legacy Game Day coaches-only notes wiring', () => {
    it('renders an initially hidden private panel with explicit limits and audience copy', () => {
        expect(source).toContain('id="coaches-only-note-panel" class="hidden');
        expect(source).toContain('id="coaches-only-note-input"');
        expect(source).toContain('maxlength="5000" disabled');
        expect(source).toContain('Visible only to team owners and admins.');
        expect(source).toContain('not included in family views, game-helper access, recaps, or AI summaries');
        expect(source).toContain('id="coaches-only-note-retry"');
        expect(source).toContain('id="coaches-only-note-save"');
    });

    it('uses the focused private-note module instead of the parent-readable game update path', () => {
        expect(source).toContain("from './js/coaches-only-game-notes.js?v=1'");
        expect(source).toContain("import { doc, getDocFromServer, serverTimestamp, setDoc } from './js/vendor/firebase-firestore.js';");
        expect(source).toContain('await loadCoachesOnlyGameNote({');
        expect(source).toContain('await saveCoachesOnlyGameNote({');
        expect(source).toContain('db,\n                    doc,\n                    setDoc,\n                    serverTimestamp,');
        expect(source).toContain('state.coachesOnlyNoteLoadInFlight ||');
        expect(source).not.toMatch(/updateGame\([^)]*coachesOnly/i);
    });

    it('does not request the private note until every limited helper branch has returned', () => {
        const accessResolution = source.indexOf("if (accessInfo.accessLevel === 'stream-score')");
        const finalLimitedBranch = source.indexOf("if (accessInfo.accessLevel === 'videographer')");
        const privatePanelInitialization = source.indexOf('initializeCoachesOnlyNotePanel();');
        const privateLoad = source.indexOf('void loadCoachesOnlyNote();');

        expect(accessResolution).toBeGreaterThan(-1);
        expect(finalLimitedBranch).toBeGreaterThan(accessResolution);
        expect(privatePanelInitialization).toBeGreaterThan(finalLimitedBranch);
        expect(privateLoad).toBeGreaterThan(privatePanelInitialization);
    });

    it('clears private text and reauthorizes the page when the authenticated principal changes', () => {
        expect(source).toContain('const principalChanged = activeAuthUid !== null && activeAuthUid !== nextAuthUid;');
        expect(source).toContain('if (principalChanged) resetCoachesOnlyNotePanelForPrincipalChange();');
        expect(source).toContain('if (principalChanged) window.location.reload();');
        expect(source).toContain("if (input) input.value = '';");
        expect(source).toContain("panel?.classList.add('hidden');");
        expect(source).toContain('requestGeneration !== state.coachesOnlyNoteRequestGeneration || principalUid !== state.user?.uid');
    });

    it('keeps the private note out of AI context, summaries, and the subscribed game document', () => {
        const aiContextStart = source.indexOf('function ensureAiChatContext()');
        const aiContextEnd = source.indexOf('function formatAiErrorSummary', aiContextStart);
        const aiContextSource = source.slice(aiContextStart, aiContextEnd);
        expect(aiContextSource).not.toContain('coachesOnlyNote');
        expect(aiContextSource).not.toContain('coachNotes');
        expect(source).not.toContain('state.game.coachesOnlyNote');
        expect(source).not.toContain('state.game.coachNotes');
    });

    it('preserves encoded shared-game route identity when opening Command Center', () => {
        expect(scheduleSource).toContain('gameId=${encodeURIComponent(game.id)}');
        expect(source).toContain("gameId.startsWith('shared_')");
        expect(source).toContain('getGameDayTeamContext(teamId, isSharedGameRoute ? null : gameId)');
    });
});
