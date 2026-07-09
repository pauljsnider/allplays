import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { commitStandardTrackerFinishData } from '../../js/track-finish.js';
import { hasPlayerProfileParticipation } from '../../js/player-profile-stats.js';

function createFirestoreHarness({ commitFailuresByBatchIndex = {} } = {}) {
    const batches = [];
    let autoId = 0;

    return {
        db: { name: 'mock-db' },
        batches,
        writeBatch: () => {
            const batchIndex = batches.length;
            const batch = {
                operations: [],
                commitCount: 0,
                set(ref, data) {
                    this.operations.push({ type: 'set', ref, data });
                },
                update(ref, data) {
                    this.operations.push({ type: 'update', ref, data });
                },
                delete(ref) {
                    this.operations.push({ type: 'delete', ref });
                },
                async commit() {
                    this.commitCount += 1;
                    if (commitFailuresByBatchIndex[batchIndex]) {
                        throw commitFailuresByBatchIndex[batchIndex];
                    }
                }
            };
            batches.push(batch);
            return batch;
        },
        collection: (_db, path) => ({ type: 'collection', path }),
        doc: (...args) => {
            if (args.length === 1 && args[0]?.type === 'collection') {
                autoId += 1;
                return { path: `${args[0].path}/auto-${autoId}` };
            }

            if (args.length === 3) {
                return { path: `${args[1]}/${args[2]}` };
            }

            throw new Error(`Unsupported doc() call: ${JSON.stringify(args)}`);
        }
    };
}

function buildGameLog(count) {
    return Array.from({ length: count }, (_, index) => ({
        text: `Event ${index + 1}`,
        time: '00:01',
        period: 'Q1',
        timestamp: index + 1,
        undoData: {
            type: 'stat',
            playerId: `player-${index + 1}`,
            statKey: 'PTS',
            value: 1,
            isOpponent: false
        }
    }));
}

function buildRoster(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `player-${index + 1}`,
        name: `Player ${index + 1}`,
        number: String(index + 1)
    }));
}

async function runFinishSave({ eventCount, rosterCount }) {
    const harness = createFirestoreHarness();

    const result = await commitStandardTrackerFinishData({
        db: harness.db,
        writeBatch: harness.writeBatch,
        doc: harness.doc,
        collection: harness.collection,
        teamId: 'team-1',
        gameId: 'game-1',
        currentUserUid: 'coach-1',
        gameLog: buildGameLog(eventCount),
        players: buildRoster(rosterCount),
        playerStatsByPlayerId: {},
        columns: ['PTS', 'AST'],
        finalHome: 12,
        finalAway: 10,
        summary: 'Finished cleanly.',
        opponentStats: {}
    });

    return { harness, result };
}

function extractBlockBody(source, marker) {
    const markerIndex = source.indexOf(marker);
    expect(markerIndex).toBeGreaterThan(-1);
    const bodyStart = source.indexOf('{', markerIndex);
    expect(bodyStart).toBeGreaterThan(markerIndex);

    let depth = 0;
    let quote = null;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        const nextChar = source[index + 1];

        if (inLineComment) {
            if (char === '\n') {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === '*' && nextChar === '/') {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === '/' && nextChar === '/') {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === '/' && nextChar === '*') {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            continue;
        }

        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(bodyStart + 1, index);
            }
        }
    }

    throw new Error(`Could not extract block body for marker: ${marker}`);
}

async function runBodyWithContext(body, context) {
    const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;
    const runtime = {
        Array,
        Boolean,
        Date,
        Error,
        JSON,
        Math,
        Number,
        Object,
        Promise,
        String,
        isNaN,
        parseFloat,
        parseInt,
        ...context
    };
    const runner = new AsyncFunction(...Object.keys(runtime), body);
    return runner(...Object.values(runtime));
}

describe('standard tracker finish batch limits', () => {
    it('chunks game logs and aggregated stat writes before final game update', async () => {
        const { harness, result } = await runFinishSave({
            eventCount: 499,
            rosterCount: 905
        });

        expect(result.eventBatchSizes).toEqual([499]);
        expect(result.aggregatedStatsBatchSizes).toEqual([450, 450, 450, 450, 10]);
        expect(result.gameUpdateBatchSize).toBe(1);
        expect(harness.batches).toHaveLength(7);

        const [eventBatch, ...secondaryBatches] = harness.batches;
        const gameUpdateBatch = secondaryBatches.pop();
        expect(eventBatch.commitCount).toBe(1);
        expect(eventBatch.operations).toHaveLength(499);
        expect(eventBatch.operations.every((op) => op.type === 'set')).toBe(true);

        expect(secondaryBatches.map((batch) => batch.operations.length)).toEqual([450, 450, 450, 450, 10]);
        secondaryBatches.forEach((batch) => {
            expect(batch.commitCount).toBe(1);
            expect(batch.operations.every((op) => ['set', 'delete'].includes(op.type))).toBe(true);
        });
        expect(secondaryBatches[0].operations.slice(0, 2)).toEqual([
            expect.objectContaining({ type: 'set', ref: { path: 'teams/team-1/games/game-1/aggregatedStats/player-1' } }),
            expect.objectContaining({ type: 'delete', ref: { path: 'teams/team-1/games/game-1/privatePlayerStats/player-1' } })
        ]);
        expect(secondaryBatches.flatMap((batch) => batch.operations).filter((op) => op.type === 'delete')).toHaveLength(905);
        expect(gameUpdateBatch.operations).toEqual([
            expect.objectContaining({
                type: 'update',
                ref: { path: 'teams/team-1/games/game-1' },
                data: expect.objectContaining({
                    status: 'completed'
                })
            })
        ]);
        expect(gameUpdateBatch.operations[0].data).not.toHaveProperty('liveStatus');
    });

    it('preserves zero-stat DNP participation metadata when resaving standard tracker games', async () => {
        const harness = createFirestoreHarness();

        await commitStandardTrackerFinishData({
            db: harness.db,
            writeBatch: harness.writeBatch,
            doc: harness.doc,
            collection: harness.collection,
            teamId: 'team-1',
            gameId: 'game-1',
            currentUserUid: 'coach-1',
            gameLog: [],
            players: [
                { id: 'p1', name: 'Ava', number: '3' },
                { id: 'p2', name: 'Ben', number: '8' },
                { id: 'p3', name: 'Cam', number: '11' }
            ],
            playerStatsByPlayerId: {
                p1: { pts: 6, ast: 1 },
                p3: { pts: 0, ast: 0 }
            },
            playerParticipationByPlayerId: {
                p3: { participated: false, participationStatus: 'did-not-appear', didNotPlay: true }
            },
            columns: ['PTS', 'AST'],
            finalHome: 6,
            finalAway: 4,
            summary: 'Finished cleanly.',
            opponentStats: {}
        });

        const statsBatch = harness.batches[0];
        const untouchedWrite = statsBatch.operations.find((op) => op.ref.path === 'teams/team-1/games/game-1/aggregatedStats/p2');
        const explicitZeroStatWrite = statsBatch.operations.find((op) => op.ref.path === 'teams/team-1/games/game-1/aggregatedStats/p3');

        expect(untouchedWrite.data).toEqual({
            playerName: 'Ben',
            playerNumber: '8',
            participated: false,
            participationStatus: 'did-not-appear',
            participationSource: 'standard-tracker-finish',
            didNotPlay: true,
            stats: { pts: 0, ast: 0 }
        });
        expect(hasPlayerProfileParticipation(untouchedWrite.data)).toBe(false);
        expect(explicitZeroStatWrite.data).toEqual({
            playerName: 'Cam',
            playerNumber: '11',
            participated: false,
            participationStatus: 'did-not-appear',
            participationSource: 'standard-tracker-finish',
            didNotPlay: true,
            stats: { pts: 0, ast: 0 }
        });
        expect(hasPlayerProfileParticipation(explicitZeroStatWrite.data)).toBe(false);
    });

    it('writes private player stats to manager-only docs when finishing a standard tracker game', async () => {
        const harness = createFirestoreHarness();

        await commitStandardTrackerFinishData({
            db: harness.db,
            writeBatch: harness.writeBatch,
            doc: harness.doc,
            collection: harness.collection,
            teamId: 'team-1',
            gameId: 'game-1',
            currentUserUid: 'coach-1',
            gameLog: [],
            players: [{ id: 'p1', name: 'Ava', number: '3' }],
            playerStatsByPlayerId: { p1: { pts: 8, effort: 4 } },
            columns: ['PTS', 'EFFORT'],
            statTrackerConfig: {
                columns: ['PTS', 'EFFORT'],
                statDefinitions: [
                    { label: 'PTS', acronym: 'PTS' },
                    { label: 'Coach Effort', acronym: 'EFFORT', id: 'effort', visibility: 'private', scope: 'player' }
                ]
            },
            finalHome: 8,
            finalAway: 6,
            summary: 'Finished cleanly.',
            opponentStats: {}
        });

        const statsBatch = harness.batches[0];
        expect(statsBatch.operations).toEqual([
            expect.objectContaining({
                ref: { path: 'teams/team-1/games/game-1/aggregatedStats/p1' },
                data: expect.objectContaining({ stats: { pts: 8 } })
            }),
            expect.objectContaining({
                ref: { path: 'teams/team-1/games/game-1/privatePlayerStats/p1' },
                data: expect.objectContaining({ stats: { effort: 4 } })
            })
        ]);
    });

    it('deletes stale private player stats when the current finish has no private data', async () => {
        const harness = createFirestoreHarness();

        await commitStandardTrackerFinishData({
            db: harness.db,
            writeBatch: harness.writeBatch,
            doc: harness.doc,
            collection: harness.collection,
            teamId: 'team-1',
            gameId: 'game-1',
            currentUserUid: 'coach-1',
            gameLog: [],
            players: [{ id: 'p1', name: 'Ava', number: '3' }],
            playerStatsByPlayerId: { p1: { pts: 8 } },
            columns: ['PTS'],
            statTrackerConfig: {
                columns: ['PTS'],
                statDefinitions: [
                    { label: 'PTS', acronym: 'PTS', scope: 'player' }
                ]
            },
            finalHome: 8,
            finalAway: 6,
            summary: 'Finished cleanly.',
            opponentStats: {}
        });

        expect(harness.batches[0].operations).toEqual([
            expect.objectContaining({
                type: 'set',
                ref: { path: 'teams/team-1/games/game-1/aggregatedStats/p1' },
                data: expect.objectContaining({ stats: { pts: 8 } })
            }),
            {
                type: 'delete',
                ref: { path: 'teams/team-1/games/game-1/privatePlayerStats/p1' }
            }
        ]);
    });

    it('chunks more than 500 game logs instead of rejecting the finish', async () => {
        const { harness, result } = await runFinishSave({
            eventCount: 1001,
            rosterCount: 12
        });

        expect(result.eventBatchSizes).toEqual([500, 500, 1]);
        expect(result.aggregatedStatsBatchSizes).toEqual([24]);
        expect(harness.batches.map((batch) => batch.operations.length)).toEqual([500, 500, 1, 24, 1]);
        expect(harness.batches[0].operations[0].ref.path).toBe('teams/team-1/games/game-1/events/finish-log-000001');
        expect(harness.batches[0].operations[499].ref.path).toBe('teams/team-1/games/game-1/events/finish-log-000500');
        expect(harness.batches[1].operations[0].ref.path).toBe('teams/team-1/games/game-1/events/finish-log-000501');
        expect(harness.batches[2].operations[0].ref.path).toBe('teams/team-1/games/game-1/events/finish-log-001001');
        expect(harness.batches.at(-1).operations).toEqual([
            expect.objectContaining({ type: 'update', data: expect.objectContaining({ status: 'completed' }) })
        ]);
        expect(harness.batches.at(-1).operations[0].data).not.toHaveProperty('liveStatus');
    });

    it('preserves beta basketball finish event clocks, jersey numbers, playing time, and DNP status', async () => {
        const harness = createFirestoreHarness();

        await commitStandardTrackerFinishData({
            db: harness.db,
            writeBatch: harness.writeBatch,
            doc: harness.doc,
            collection: harness.collection,
            teamId: 'team-1',
            gameId: 'game-1',
            currentUserUid: 'coach-1',
            gameLog: [{ text: 'Ava made a basket', clock: '03:21', period: 'Q4', ts: 99 }],
            players: [
                { id: 'p1', name: 'Ava', num: '23' },
                { id: 'p2', name: 'Ben', num: '12' }
            ],
            playerStatsByPlayerId: {
                p1: { pts: 2, fouls: 1, time: 123000 },
                p2: { pts: 0, fouls: 0, time: 0 }
            },
            columns: ['PTS', 'FOULS'],
            finalHome: 44,
            finalAway: 40,
            summary: 'Finished cleanly.',
            opponentStats: {},
            includeTimeMs: true
        });

        expect(harness.batches[0].operations[0].data).toMatchObject({
            gameTime: '03:21',
            timestamp: 99
        });
        expect(harness.batches[1].operations[0].data).toMatchObject({
            playerName: 'Ava',
            playerNumber: '23',
            participated: true,
            participationStatus: 'appeared',
            timeMs: 123000,
            stats: expect.objectContaining({ pts: 2, fouls: 1 })
        });
        expect(harness.batches[1].operations[1]).toEqual({
            type: 'delete',
            ref: { path: 'teams/team-1/games/game-1/privatePlayerStats/p1' }
        });
        const benWrite = harness.batches[1].operations.find((op) => op.ref.path === 'teams/team-1/games/game-1/aggregatedStats/p2');
        expect(benWrite.data).toMatchObject({
            playerName: 'Ben',
            playerNumber: '12',
            participated: false,
            participationStatus: 'did-not-appear',
            didNotPlay: true,
            timeMs: 0,
            stats: { pts: 0, fouls: 0 }
        });
        expect(harness.batches[1].operations[3]).toEqual({
            type: 'delete',
            ref: { path: 'teams/team-1/games/game-1/privatePlayerStats/p2' }
        });
        expect(hasPlayerProfileParticipation(benWrite.data)).toBe(false);
    });

    it('rejects when a secondary aggregated stats batch fails after primary commit', async () => {
        const statsBatchFailure = new Error('Secondary aggregated stats batch failed');
        const harness = createFirestoreHarness({
            commitFailuresByBatchIndex: {
                2: statsBatchFailure
            }
        });

        await expect(commitStandardTrackerFinishData({
            db: harness.db,
            writeBatch: harness.writeBatch,
            doc: harness.doc,
            collection: harness.collection,
            teamId: 'team-1',
            gameId: 'game-1',
            currentUserUid: 'coach-1',
            gameLog: buildGameLog(499),
            players: buildRoster(905),
            playerStatsByPlayerId: {},
            columns: ['PTS', 'AST'],
            finalHome: 12,
            finalAway: 10,
            summary: 'Partially saved before stats failure.',
            opponentStats: {}
        })).rejects.toBe(statsBatchFailure);

        expect(harness.batches).toHaveLength(3);
        expect(harness.batches[0].commitCount).toBe(1);
        expect(harness.batches[1].commitCount).toBe(1);
        expect(harness.batches[2].commitCount).toBe(1);
        expect(harness.batches[0].operations).toHaveLength(499);
        expect(harness.batches[1].operations).toHaveLength(450);
        expect(harness.batches[2].operations).toHaveLength(450);
        expect(harness.batches.some((batch) => batch.operations.some((op) => op.type === 'update'))).toBe(false);
    });

    it('rewrites deterministic finish docs when retrying after the final game update fails', async () => {
        const gameUpdateFailure = new Error('Final game update failed');
        const harness = createFirestoreHarness({
            commitFailuresByBatchIndex: {
                2: gameUpdateFailure
            }
        });
        const finishPayload = {
            db: harness.db,
            writeBatch: harness.writeBatch,
            doc: harness.doc,
            collection: harness.collection,
            teamId: 'team-1',
            gameId: 'game-1',
            currentUserUid: 'coach-1',
            gameLog: [
                { text: 'Ava made a basket', clock: '05:11', period: 'Q2', ts: 123 },
                { text: 'Ava drew a foul', clock: '04:58', period: 'Q2', ts: 124 }
            ],
            players: [{ id: 'p1', name: 'Ava', number: '23' }],
            playerStatsByPlayerId: { p1: { pts: 2, effort: 4 } },
            columns: ['PTS', 'EFFORT'],
            statTrackerConfig: {
                columns: ['PTS', 'EFFORT'],
                statDefinitions: [
                    { label: 'PTS', acronym: 'PTS' },
                    { label: 'Coach Effort', acronym: 'EFFORT', id: 'effort', visibility: 'private', scope: 'player' }
                ]
            },
            finalHome: 14,
            finalAway: 12,
            summary: 'Partial finish failed at the end.',
            opponentStats: { opponent: { pts: 12 } }
        };

        await expect(commitStandardTrackerFinishData(finishPayload)).rejects.toBe(gameUpdateFailure);
        const firstAttemptEventPaths = harness.batches[0].operations.map((op) => op.ref.path);
        const firstAttemptStatPaths = harness.batches[1].operations.map((op) => op.ref.path);

        const result = await commitStandardTrackerFinishData({
            ...finishPayload,
            playerStatsByPlayerId: { p1: { pts: 5, effort: 7 } },
            finalHome: 18,
            finalAway: 16,
            summary: 'Retried finish succeeded.'
        });

        expect(result).toMatchObject({
            eventBatchSizes: [2],
            aggregatedStatsBatchSizes: [2],
            gameUpdateBatchSize: 1
        });
        expect(harness.batches).toHaveLength(6);
        expect(harness.batches.map((batch) => batch.commitCount)).toEqual([1, 1, 1, 1, 1, 1]);
        expect(harness.batches[2].operations).toEqual([
            expect.objectContaining({
                type: 'update',
                ref: { path: 'teams/team-1/games/game-1' },
                data: expect.objectContaining({
                    homeScore: 14,
                    awayScore: 12,
                    summary: 'Partial finish failed at the end.',
                    status: 'completed'
                })
            })
        ]);
        expect(harness.batches[3].operations.map((op) => op.ref.path)).toEqual(firstAttemptEventPaths);
        expect(harness.batches[4].operations.map((op) => op.ref.path)).toEqual(firstAttemptStatPaths);
        expect(harness.batches[3].operations.map((op) => op.ref.path)).toEqual([
            'teams/team-1/games/game-1/events/finish-log-000001',
            'teams/team-1/games/game-1/events/finish-log-000002'
        ]);
        expect(harness.batches[4].operations).toEqual([
            expect.objectContaining({
                ref: { path: 'teams/team-1/games/game-1/aggregatedStats/p1' },
                data: expect.objectContaining({ stats: { pts: 5 } })
            }),
            expect.objectContaining({
                ref: { path: 'teams/team-1/games/game-1/privatePlayerStats/p1' },
                data: expect.objectContaining({ stats: { effort: 7 } })
            })
        ]);
        expect(harness.batches[5].operations).toEqual([
            expect.objectContaining({
                type: 'update',
                ref: { path: 'teams/team-1/games/game-1' },
                data: expect.objectContaining({
                    homeScore: 18,
                    awayScore: 16,
                    summary: 'Retried finish succeeded.',
                    status: 'completed'
                })
            })
        ]);
    });

    it('wires the beta basketball tracker finish path through the tested finish helper', () => {
        const source = readFileSync(new URL('../../js/track-basketball.js', import.meta.url), 'utf8');
        const saveAndCompleteIndex = source.indexOf('async function saveAndComplete()');
        const helperAwaitIndex = source.indexOf('await commitStandardTrackerFinishData({', saveAndCompleteIndex);
        const catchIndex = source.indexOf('} catch (error) {', helperAwaitIndex);

        expect(source).toContain("import { commitStandardTrackerFinishData } from './track-finish.js?v=2';");
        expect(helperAwaitIndex).toBeGreaterThan(saveAndCompleteIndex);
        expect(source.indexOf('includeTimeMs: true', helperAwaitIndex)).toBeGreaterThan(helperAwaitIndex);
        expect(source.indexOf('const batch = writeBatch(db);', saveAndCompleteIndex)).toBe(-1);
        expect(catchIndex).toBeGreaterThan(helperAwaitIndex);
    });

    it('wires the production track.html submit path through the tested finish helper before success-only side effects', () => {
        const source = readFileSync(new URL('../../track.html', import.meta.url), 'utf8');

        expect(source).toContain("import { commitStandardTrackerFinishData } from './js/track-finish.js?v=2';");
        expect(source).toContain('await commitStandardTrackerFinishData({');
        expect(source).toContain('gameState.playerParticipationByPlayerId[doc.id]');

        const helperAwaitIndex = source.indexOf('await commitStandardTrackerFinishData({');
        const participationParamIndex = source.indexOf('playerParticipationByPlayerId: gameState.playerParticipationByPlayerId', helperAwaitIndex);
        const successLogIndex = source.indexOf("console.log('Game data saved successfully')", helperAwaitIndex);
        const finishingFlagIndex = source.indexOf('isFinishing = true;', helperAwaitIndex);
        const mailtoRedirectIndex = source.indexOf('window.location.href = mailto;', helperAwaitIndex);
        const gameRedirectIndex = source.indexOf('window.location.href = `game.html#teamId=${currentTeamId}&gameId=${currentGameId}`;', helperAwaitIndex);
        const catchIndex = source.indexOf('} catch (error) {', helperAwaitIndex);
        const alertIndex = source.indexOf("alert('Error finishing game: ' + error.message);", catchIndex);

        expect(participationParamIndex).toBeGreaterThan(helperAwaitIndex);
        expect(successLogIndex).toBeGreaterThan(helperAwaitIndex);
        expect(finishingFlagIndex).toBeGreaterThan(helperAwaitIndex);
        expect(mailtoRedirectIndex).toBeGreaterThan(helperAwaitIndex);
        expect(gameRedirectIndex).toBeGreaterThan(helperAwaitIndex);
        expect(catchIndex).toBeGreaterThan(helperAwaitIndex);
        expect(alertIndex).toBeGreaterThan(catchIndex);
        expect(participationParamIndex).toBeLessThan(catchIndex);
        expect(successLogIndex).toBeLessThan(catchIndex);
        expect(finishingFlagIndex).toBeLessThan(catchIndex);
        expect(mailtoRedirectIndex).toBeLessThan(catchIndex);
        expect(gameRedirectIndex).toBeLessThan(catchIndex);
    });

    it('keeps the production tracker on-page when the finish commit rejects', async () => {
        const source = readFileSync(new URL('../../track.html', import.meta.url), 'utf8');
        const body = extractBlockBody(source, "finishForm.addEventListener('submit', async (e) => {");
        const finishError = new Error('Firestore rejected finalization');
        const commitStandardTrackerFinishDataMock = vi.fn().mockRejectedValue(finishError);
        const alertMock = vi.fn();
        const setTimeoutMock = vi.fn();
        const preventDefault = vi.fn();
        const elements = {
            finalHomeScore: { value: '21' },
            finalAwayScore: { value: '18' },
            gameSummary: { value: 'Tough finish.' },
            sendEmailCheckbox: { checked: true }
        };
        const context = {
            alert: alertMock,
            collection: vi.fn(),
            commitStandardTrackerFinishData: commitStandardTrackerFinishDataMock,
            console: { error: vi.fn(), log: vi.fn() },
            currentConfig: { columns: ['PTS'] },
            currentGame: { opponent: 'Wildcats', status: 'scheduled' },
            currentGameId: 'game-1',
            currentTeam: { name: 'Tigers', notificationEmail: 'coach@example.com' },
            currentTeamId: 'team-1',
            currentUser: { uid: 'coach-1', email: 'coach@example.com' },
            db: {},
            doc: vi.fn(),
            document: {
                getElementById: vi.fn((id) => elements[id])
            },
            e: { preventDefault },
            gameState: {
                gameLog: [{ text: 'Final whistle' }],
                opponentStats: {},
                playerParticipationByPlayerId: {},
                playerStats: {}
            },
            generateEmailBody: vi.fn(() => 'Email body'),
            getGame: vi.fn().mockResolvedValue({ status: 'scheduled' }),
            isCancelledGame: vi.fn(() => false),
            isFinishing: false,
            parseInt,
            players: [{ id: 'p1', name: 'Ava', number: '3' }],
            resolveSummaryRecipient: vi.fn(() => 'coach@example.com'),
            setTimeout: setTimeoutMock,
            window: { location: { href: 'track.html#teamId=team-1&gameId=game-1' } },
            writeBatch: vi.fn()
        };

        await runBodyWithContext(body, context);

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(commitStandardTrackerFinishDataMock).toHaveBeenCalled();
        expect(alertMock).toHaveBeenCalledWith('Error finishing game: Firestore rejected finalization');
        expect(context.isFinishing).toBe(false);
        expect(context.window.location.href).toBe('track.html#teamId=team-1&gameId=game-1');
        expect(setTimeoutMock).not.toHaveBeenCalled();
        expect(context.generateEmailBody).not.toHaveBeenCalled();
        expect(context.resolveSummaryRecipient).not.toHaveBeenCalled();
    });

    it('keeps the beta basketball tracker on-page when the finish commit rejects', async () => {
        const source = readFileSync(new URL('../../js/track-basketball.js', import.meta.url), 'utf8');
        const body = extractBlockBody(source, 'async function saveAndComplete()');
        const finishError = new Error('Firestore rejected finalization');
        const commitStandardTrackerFinishDataMock = vi.fn().mockRejectedValue(finishError);
        const alertMock = vi.fn();
        const setTimeoutMock = vi.fn();
        const context = {
            addLog: vi.fn(),
            alert: alertMock,
            collection: vi.fn(),
            commitStandardTrackerFinishData: commitStandardTrackerFinishDataMock,
            console: { error: vi.fn(), log: vi.fn() },
            currentConfig: { columns: ['PTS', 'AST'] },
            currentGame: { opponent: 'Wildcats', status: 'scheduled' },
            currentGameId: 'game-1',
            currentTeam: { name: 'Tigers', notificationEmail: 'coach@example.com' },
            currentTeamId: 'team-1',
            currentUser: { uid: 'coach-1', email: 'coach@example.com' },
            db: {},
            doc: vi.fn(),
            els: {
                homeFinal: { value: '42' },
                awayFinal: { value: '39' },
                notesFinal: { value: 'Closed strong.' },
                finishSendEmail: { checked: true }
            },
            generateEmailBody: vi.fn(() => 'Email body'),
            getGame: vi.fn().mockResolvedValue({ status: 'scheduled' }),
            isCancelledGame: vi.fn(() => false),
            isFinishing: false,
            parseInt,
            resolveFinalScoreForCompletion: vi.fn(({ requestedHome, requestedAway }) => ({
                home: requestedHome,
                away: requestedAway,
                reconciled: false,
                mismatch: false
            })),
            resolveSummaryRecipient: vi.fn(() => 'coach@example.com'),
            roster: [{ id: 'p1', name: 'Ava', num: '3' }],
            setTimeout: setTimeoutMock,
            state: {
                away: 39,
                home: 42,
                log: [{ text: 'Ava made a basket', clock: '00:15', period: 'Q4' }],
                opp: [{ id: 'opp-1', name: 'Opponent', number: '5', stats: { pts: 4, fouls: 1 } }],
                scoreLogIsComplete: true,
                stats: { p1: { pts: 12, ast: 3, time: 90000 } }
            },
            window: { location: { href: 'track-basketball.html#teamId=team-1&gameId=game-1' } },
            writeBatch: vi.fn()
        };

        await runBodyWithContext(body, context);

        expect(commitStandardTrackerFinishDataMock).toHaveBeenCalledWith(expect.objectContaining({
            includeTimeMs: true,
            finalHome: 42,
            finalAway: 39
        }));
        expect(alertMock).toHaveBeenCalledWith('Error finishing game: Firestore rejected finalization');
        expect(context.isFinishing).toBe(false);
        expect(context.window.location.href).toBe('track-basketball.html#teamId=team-1&gameId=game-1');
        expect(setTimeoutMock).not.toHaveBeenCalled();
        expect(context.generateEmailBody).not.toHaveBeenCalled();
        expect(context.resolveSummaryRecipient).not.toHaveBeenCalled();
    });
});
