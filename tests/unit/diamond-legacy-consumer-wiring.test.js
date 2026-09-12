import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readPage = (name) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');

describe('legacy Diamond consumer wiring', () => {
    it('routes team-chat AI stats and events through the complete mixed-engine bridge', () => {
        const source = readPage('team-chat.html');
        expect(source).toContain("from './js/diamond-legacy-game-context.js?v=1'");
        expect(source).toContain('loadCompleteAiGameContext({');
        expect(source).toContain('getGames(teamId, { requireCompleteSharedGames: true })');
        expect(source).not.toContain('getAggregatedStatsForGames(teamId, completedGames.map');
        expect(source).not.toContain('getGameEvents(teamId, game.id, { limit: AI_EVENTS_PER_GAME_LIMIT })');
    });

    it('does not make the unused legacy last-game stats read on game-day', () => {
        const source = readPage('game-day.html');
        const loadLastGame = source.slice(source.indexOf('async function loadLastGame()'), source.indexOf('// ==================== AI COACH FOCUS'));
        expect(loadLastGame).not.toContain('getAggregatedStatsForGames');
    });

    it('preserves Diamond projection identity and checks incentive evidence before caching earnings', () => {
        const source = readPage('parent-dashboard.html');
        expect(source).toContain("from './js/diamond-legacy-game-context.js?v=1'");
        expect(source).toContain('trackingEngine: game.trackingEngine || null');
        expect(source).toContain('diamondScorebookInstanceId: game.diamondScorebookInstanceId || null');
        expect(source).toContain('loadCompletePlayerStatsForGames({');
        const refresh = source.slice(source.indexOf('async function refreshIncentivesPanel()'), source.indexOf('function openIncentiveRuleBuilder('));
        expect(refresh).toContain('getGames(teamId, { requireCompleteSharedGames: true })');
        expect(refresh).not.toContain('const pastGames = allScheduleEvents');
        expect(source).toContain('assertCompleteIncentiveStatEvidence(');
        expect(source.indexOf('assertCompleteIncentiveStatEvidence(')).toBeLessThan(source.indexOf('incentivesEarningsCache.set('));
    });

    it('only caches a complete mixed-engine drills AI context and lets incomplete evidence fail closed', () => {
        const source = readPage('drills.html');
        expect(source).toContain("from './js/diamond-legacy-game-context.js?v=1'");
        expect(source).toContain('const loaded = await loadCompleteAiGameContext({');
        expect(source).toContain('getGames(state.teamId, { requireCompleteSharedGames: true })');
        expect(source).toContain('state.aiRawGameContext = completeContext;');
        const ensureContext = source.slice(source.indexOf('async function ensureRawGameContext()'), source.indexOf('function normalizeForAiPayload'));
        const contextRail = source.slice(source.indexOf('async function loadContextRail()'), source.indexOf('function renderGameIntelligencePanels('));
        expect(contextRail).toContain('getGames(state.teamId)');
        expect(contextRail).not.toContain('requireCompleteSharedGames');
        expect(ensureContext).toContain('getGames(state.teamId, { requireCompleteSharedGames: true })');
        expect(ensureContext).not.toMatch(/catch\s*\(/);
        const promptContext = source.slice(source.indexOf('async function buildAiPromptContext('), source.indexOf('async function ensureRawGameContext()'));
        expect(promptContext).not.toContain('unable to load raw game context');
    });

    it('keeps cache-only foreign Diamond games visible but blocks trend AI and persistence until evidence is complete', () => {
        const source = readPage('drills.html');
        const contextRail = source.slice(source.indexOf('async function loadContextRail()'), source.indexOf('function renderPlayerHighlights('));
        const diamondGateStart = contextRail.indexOf('const unvalidatedDiamondGames = recent.filter(hasDiamondContextMarker);');
        const classicTrendStart = contextRail.indexOf('const gf = recent.reduce');
        const diamondGate = contextRail.slice(diamondGateStart, classicTrendStart);

        expect(diamondGateStart).toBeGreaterThan(-1);
        expect(classicTrendStart).toBeGreaterThan(diamondGateStart);
        expect(diamondGate).toContain("reason: foreignSharedGame ? 'shared-game-source-not-owned' : 'diamond-context-not-validated'");
        expect(diamondGate).toContain('absenceConfirmed: false');
        expect(diamondGate).toContain('retryable: !foreignSharedGame');
        expect(diamondGate).toContain('state.gameIntelligence = null;');
        expect(diamondGate).not.toContain('evaluateGameIntelligence(');
        expect(diamondGate).not.toContain('persistGameIntelligenceContext(');
        expect(diamondGate).toContain('return;');
    });

    it('expands an owned Diamond rail only after the strict bridge validates stats, events, inventory, and scores', () => {
        const source = readPage('drills.html');
        const ensureContext = source.slice(source.indexOf('async function ensureRawGameContext()'), source.indexOf('function normalizeForAiPayload'));

        expect(ensureContext).toContain('getGames(state.teamId, { requireCompleteSharedGames: true })');
        expect(ensureContext).toContain('const loaded = await loadCompleteAiGameContext({');
        expect(ensureContext).toContain('const scoreContext = summarizeKnownGameScores(eventGames);');
        expect(ensureContext).toContain('if (hasDiamondGames && eventGames.length > 0 && scoreContext.complete)');
        expect(ensureContext).toContain('if (scoreContext.complete) state.aiRawGameContext = completeContext;');
        expect(ensureContext.indexOf('state.aiRawGameContext = completeContext;'))
            .toBeGreaterThan(ensureContext.indexOf('const loaded = await loadCompleteAiGameContext({'));
        expect(ensureContext).toContain("source: 'validated-mixed-engine-context'");
        expect(ensureContext).toContain('state.gameIntelligence = validatedGameIntelligence;');
        expect(ensureContext).toContain('await persistGameIntelligenceContext();');
    });

    it('routes both legacy certificate generation paths through complete mixed-engine narrative evidence', () => {
        const source = readPage('js/certificates/studio.js');
        expect(source).toContain("from '../diamond-legacy-game-context.js?v=1'");
        const initial = source.slice(source.indexOf('async function generateTeamCertificates()'), source.indexOf('function renderReview()'));
        const regenerate = source.slice(source.indexOf('async function runDraftRegeneration('), source.indexOf('async function regenerateDrafts('));
        expect(initial).toContain('loadCompleteCertificateNarrativeStats({');
        expect(regenerate).toContain('loadCompleteCertificateNarrativeStats({');
        expect(initial).not.toContain('getAggregatedStatsForGames(state.teamId, recentGames.map');
        expect(regenerate).not.toContain('getAggregatedStatsForGames(state.teamId, recentGames.map');
        expect(initial).toContain('statsEvidenceByPlayer');
        expect(regenerate).toContain('statsEvidenceByPlayer');
        expect(initial).toContain('getGames(state.teamId, { requireCompleteSharedGames: true })');
        expect(regenerate).toContain('getGames(state.teamId, { requireCompleteSharedGames: true })');
        const init = source.slice(source.indexOf('async function initAuthenticated('), source.indexOf("document.getElementById('cert-new-run-btn')"));
        expect(init).toContain('getGames(state.teamId)');
        expect(init).not.toContain('requireCompleteSharedGames');
    });

    it('builds athlete profile snapshots through complete engine-aware season evidence', () => {
        const source = readPage('js/db.js');
        const summary = source.slice(source.indexOf('async function buildAthleteProfileSeasonSummary('), source.indexOf('function sanitizeAthleteProfileMediaName('));
        expect(source).toContain("from './diamond-legacy-game-context.js?v=1'");
        expect(summary).toContain('loadCompleteAthleteProfileSeasonStats({');
        expect(summary).toContain('getGames(link.teamId, { requireCompleteSharedGames: true })');
        expect(summary).toContain('const gameRef = getGameDocRef(teamId, gameId);');
        expect(summary).toContain('return statsSnap.exists() ? (statsSnap.data() || {}) : null;');
        expect(summary).toContain('playingTimeComplete');
        expect(summary).toContain('statEvidence');
        expect(summary).not.toContain('diamondByGame');
        expect(summary).not.toContain('diamondGameIds');
    });
});
