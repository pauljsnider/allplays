import { getAI, getGenerativeModel, GoogleAIBackend } from '../vendor/firebase-ai.js';
import { getApp } from '../vendor/firebase-app.js';

export const CERTIFICATE_DESCRIPTION_CHAR_LIMIT = 350;

export function truncateCertificateDescription(text = '', limit = CERTIFICATE_DESCRIPTION_CHAR_LIMIT) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= limit) return normalized;
    const truncated = normalized.slice(0, limit + 1);
    const sentenceEnd = Math.max(
        truncated.lastIndexOf('.'),
        truncated.lastIndexOf('!'),
        truncated.lastIndexOf('?')
    );
    if (sentenceEnd >= Math.floor(limit * 0.62)) {
        return truncated.slice(0, sentenceEnd + 1).trim();
    }
    const lastSpace = truncated.lastIndexOf(' ', limit - 1);
    const clipped = truncated.slice(0, lastSpace > 0 ? lastSpace : limit).trim();
    return /[.!?]$/.test(clipped) ? clipped : `${clipped.replace(/[,;:]+$/, '')}.`;
}

export function isCompletedCertificateGame(game = {}) {
    const status = String(game.status || '').toLowerCase();
    const liveStatus = String(game.liveStatus || '').toLowerCase();
    const type = String(game.type || game.eventType || '').toLowerCase();
    return type !== 'practice'
        && status !== 'cancelled'
        && status !== 'deleted'
        && (status === 'completed' || status === 'final' || liveStatus === 'completed');
}

function gameDateMs(game = {}) {
    const dateValue = game.date || game.completedAt || game.updatedAt || game.createdAt;
    const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue || 0);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function selectRecentCompletedGames(games = [], windowSize = 10) {
    const count = Number(windowSize) === 5 ? 5 : 10;
    return (Array.isArray(games) ? games : [])
        .filter(isCompletedCertificateGame)
        .sort((a, b) => gameDateMs(b) - gameDateMs(a))
        .slice(0, count);
}

function summarizeStats(stats = {}) {
    const entries = Object.entries(stats || {})
        .filter(([, value]) => Number(value || 0) !== 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}: ${value}`);
    return entries.length ? entries.join(', ') : 'No tracked stat totals available.';
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactOpponentNames(summary = '', game = {}) {
    let safeSummary = String(summary || '');
    [
        game.opponent,
        game.opponentName,
        game.opposingTeam,
        game.opponentTeamName
    ].forEach((name) => {
        const normalized = String(name || '').trim();
        if (normalized.length < 2) return;
        safeSummary = safeSummary.replace(new RegExp(escapeRegExp(normalized), 'gi'), 'the opponent');
    });
    return safeSummary;
}

function summarizeGames(games = []) {
    return games.map((game, index) => {
        const summary = redactOpponentNames(game.summary || game.gameSummary || game.notes || '', game);
        const label = `Completed game ${index + 1}`;
        return `${label}${summary ? ` - ${summary}` : ''}`;
    }).join('\n');
}

export function buildCertificateDescriptionPrompt({ team = {}, player = {}, seasonLabel = '', tone = 'celebratory and specific', games = [], stats = {} } = {}) {
    const safePlayer = {
        name: player.name || player.playerName || 'Player',
        number: player.number || player.playerNumber || ''
    };
    const sport = team.sport || 'team sport';

    return [
        'Write one youth-sports award certificate paragraph.',
        'Keep it warm, specific, and printable. Use one paragraph, aim for 230-300 characters, absolute maximum 350 characters, no markdown, no title, no bullets.',
        'End with a complete sentence. Do not trail off or end mid-thought.',
        `Tone: ${tone}.`,
        `Team: ${team.name || 'Team'}.`,
        `Sport: ${sport}.`,
        `Season: ${seasonLabel || 'season'}.`,
        `Player: ${safePlayer.name}${safePlayer.number ? `, jersey #${safePlayer.number}` : ''}.`,
        `Recent stat totals: ${summarizeStats(stats)}.`,
        `Recent game context:\n${summarizeGames(games) || 'No completed game summaries available.'}`,
        'Use stat totals only as private context to infer strengths and playing style. Do not mention exact stat numbers, totals, scores, dates, opponent names, or opposing team names.',
        'Only use roster-safe public fields: player name, jersey number, team, sport, season, summaries, and stat totals.'
    ].join('\n');
}

export function buildFallbackDescription({ team = {}, player = {}, seasonLabel = '' } = {}) {
    const name = player.name || player.playerName || 'This player';
    const sport = team.sport || 'the team';
    const season = seasonLabel ? ` during ${seasonLabel}` : '';
    return truncateCertificateDescription(`${name} brought commitment, energy, and a team-first attitude to ${sport}${season}. Their steady effort in practices and games helped set a positive standard for teammates and made them an important part of the season.`);
}

function extractTextFromResult(result) {
    if (result?.response?.text) return result.response.text().trim();
    const candidateText = result?.response?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('')
        .trim();
    return candidateText || '';
}

export async function generateCertificateDescription(context) {
    const prompt = buildCertificateDescriptionPrompt(context);
    const app = getApp();
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const text = extractTextFromResult(result);
    if (!text) throw new Error('AI did not return a certificate description.');
    return truncateCertificateDescription(text);
}

export async function generateDescriptionsForDrafts({ drafts = [], team = {}, shared = {}, games = [], totalsByPlayer = {}, generator = generateCertificateDescription, concurrency = 2, onResult = null } = {}) {
    const recentGames = selectRecentCompletedGames(games, shared.statsWindow || 10);
    const results = new Map();
    let index = 0;
    let completed = 0;

    async function recordResult(draft, result) {
        results.set(draft.id, result);
        completed += 1;
        if (typeof onResult === 'function') {
            await onResult({
                draft,
                result,
                completed,
                total: drafts.length
            });
        }
    }

    async function worker() {
        while (index < drafts.length) {
            const draft = drafts[index];
            index += 1;
            const player = {
                id: draft.playerId,
                name: draft.recipientName,
                number: draft.playerNumber
            };
            const stats = totalsByPlayer[draft.playerId] || {};
            const hasStats = Object.keys(stats).some((key) => Number(stats[key] || 0) !== 0);
            if (!hasStats) {
                await recordResult(draft, {
                    status: 'needs-review',
                    source: 'fallback',
                    description: buildFallbackDescription({ team, player, seasonLabel: shared.seasonLabel }),
                    errorMessage: null
                });
                continue;
            }

            try {
                const description = await generator({
                    team,
                    player,
                    seasonLabel: shared.seasonLabel,
                    tone: shared.descriptionTone,
                    games: recentGames,
                    stats
                });
                await recordResult(draft, {
                    status: 'ready',
                    source: 'ai',
                    description: truncateCertificateDescription(description),
                    errorMessage: null
                });
            } catch (error) {
                await recordResult(draft, {
                    status: 'error',
                    source: 'fallback',
                    description: draft.description || buildFallbackDescription({ team, player, seasonLabel: shared.seasonLabel }),
                    errorMessage: error?.message || 'AI description failed.'
                });
            }
        }
    }

    const workerCount = Math.max(1, Math.min(Number(concurrency) || 2, drafts.length || 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}
