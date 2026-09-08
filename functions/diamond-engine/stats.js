"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatInningsPitched = formatInningsPitched;
exports.formatDiamondRate = formatDiamondRate;
exports.deriveDiamondPlayerStats = deriveDiamondPlayerStats;
exports.projectDiamondStats = projectDiamondStats;
exports.isBattingQualified = isBattingQualified;
const ledger_1 = require("./ledger");
const reducer_1 = require("./reducer");
const rules_1 = require("./rules");
function emptyRawStats() {
    return {
        batting: {
            G: 0,
            GS: 0,
            PA: 0,
            AB: 0,
            R: 0,
            H: 0,
            '1B': 0,
            '2B': 0,
            '3B': 0,
            HR: 0,
            TB: 0,
            RBI: 0,
            BB: 0,
            IBB: 0,
            HBP: 0,
            SO: 0,
            SF: 0,
            SH: 0,
            ROE: 0,
            FC: 0,
            GIDP: 0
        },
        baserunning: { SB: 0, CS: 0, pickoffs: 0, advances: 0, outs: 0 },
        pitching: {
            APP: 0,
            GS: 0,
            W: 0,
            L: 0,
            SV: 0,
            BF: 0,
            outs: 0,
            H: 0,
            R: 0,
            ER: 0,
            BB: 0,
            IBB: 0,
            HBP: 0,
            SO: 0,
            HR: 0,
            WP: 0,
            balkIllegalPitch: 0,
            inheritedRunners: 0,
            inheritedScored: 0,
            pitches: 0,
            strikes: 0,
            firstPitchStrikes: 0
        },
        fielding: { defensiveOuts: 0, PO: 0, A: 0, E: 0, DP: 0, TP: 0, PB: 0 }
    };
}
function simulate(ledger) {
    return (0, ledger_1.replayEffectiveDiamondEventStates)(ledger.initialState, ledger.events);
}
function safeRatio(numerator, denominator) {
    return denominator === 0 ? null : numerator / denominator;
}
function formatInningsPitched(outs) {
    if (!Number.isInteger(outs) || outs < 0)
        return '0.0';
    return `${String(Math.floor(outs / 3))}.${String(outs % 3)}`;
}
function formatDiamondRate(value, digits = 3) {
    if (value === null || !Number.isFinite(value))
        return '—';
    return value.toFixed(digits).replace(/^0(?=\.)/, '');
}
function deriveDiamondPlayerStats(raw, coverage, eraInningsBasis) {
    const battingDenominator = raw.batting.AB + raw.batting.BB + raw.batting.IBB + raw.batting.HBP + raw.batting.SF;
    const battingComplete = coverage.batting === 'complete';
    const baserunningComplete = coverage.baserunning === 'complete';
    const pitchingComplete = coverage.pitching === 'complete';
    const pitchComplete = coverage.pitches === 'complete';
    const fieldingComplete = coverage.fielding === 'complete';
    const average = battingComplete ? safeRatio(raw.batting.H, raw.batting.AB) : null;
    const obp = battingComplete ? safeRatio(raw.batting.H + raw.batting.BB + raw.batting.IBB + raw.batting.HBP, battingDenominator) : null;
    const slugging = battingComplete ? safeRatio(raw.batting.TB, raw.batting.AB) : null;
    const chances = raw.fielding.PO + raw.fielding.A + raw.fielding.E;
    return {
        AVG: average,
        OBP: obp,
        SLG: slugging,
        OPS: obp === null || slugging === null ? null : obp + slugging,
        bbRate: battingComplete ? safeRatio(raw.batting.BB + raw.batting.IBB, raw.batting.PA) : null,
        strikeoutRate: battingComplete ? safeRatio(raw.batting.SO, raw.batting.PA) : null,
        stolenBaseRate: baserunningComplete ? safeRatio(raw.baserunning.SB, raw.baserunning.SB + raw.baserunning.CS) : null,
        inningsPitched: formatInningsPitched(raw.pitching.outs),
        ERA: pitchingComplete && raw.pitching.outs > 0 ? (raw.pitching.ER * eraInningsBasis * 3) / raw.pitching.outs : null,
        WHIP: pitchingComplete && raw.pitching.outs > 0 ? ((raw.pitching.BB + raw.pitching.IBB + raw.pitching.H) * 3) / raw.pitching.outs : null,
        strikeoutWalkRatio: pitchingComplete ? safeRatio(raw.pitching.SO, raw.pitching.BB + raw.pitching.IBB) : null,
        strikeRate: pitchComplete ? safeRatio(raw.pitching.strikes, raw.pitching.pitches) : null,
        firstPitchStrikeRate: pitchComplete ? safeRatio(raw.pitching.firstPitchStrikes, raw.pitching.BF) : null,
        fieldingPercentage: fieldingComplete ? safeRatio(raw.fielding.PO + raw.fielding.A, chances) : null,
        chances
    };
}
function isStrikePitch(result) {
    return ['called_strike', 'swinging_strike', 'foul', 'foul_bunt', 'in_play'].includes(result);
}
function battingSideFor(state) {
    return (0, reducer_1.getBattingSide)(state);
}
function isOpenDefensiveEntry(state, side) {
    const defensiveSide = battingSideFor(state) === 'home' ? 'away' : 'home';
    const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
    const inningKey = `${state.inning.half === 'top' ? 'T' : 'B'}${String(state.inning.number)}`;
    const runLimitReached = profile.inningRunLimit !== null && (state.inningRuns[inningKey] ?? 0) >= profile.inningRunLimit;
    return (state.lifecycle === 'active' &&
        side === defensiveSide &&
        state.inning.outs < 3 &&
        state.halfInningEnd === null &&
        !runLimitReached &&
        (0, reducer_1.getDiamondFinalizationReason)(state) === null);
}
function addMergedFielding(fieldings, actualOutCount, side, eventId, ensure, credit, options = {}) {
    const putouts = (0, reducer_1.deriveDiamondPutoutCredits)(fieldings, actualOutCount);
    const assists = new Set();
    const passedBalls = new Set();
    const errorMultiplicity = new Map();
    let doublePlay = false;
    let triplePlay = false;
    fieldings.forEach((fielding) => {
        (fielding.assists ?? []).forEach((playerId) => assists.add(playerId));
        const chainErrors = new Map();
        (fielding.errors ?? []).forEach(({ playerId, kind }) => {
            const counts = chainErrors.get(playerId) ?? { total: 0, fielding: 0, throwing: 0 };
            counts.total += 1;
            if (kind)
                counts[kind] += 1;
            chainErrors.set(playerId, counts);
        });
        chainErrors.forEach((counts, playerId) => {
            const merged = errorMultiplicity.get(playerId) ?? { maxChainTotal: 0, maxFielding: 0, maxThrowing: 0 };
            merged.maxChainTotal = Math.max(merged.maxChainTotal, counts.total);
            merged.maxFielding = Math.max(merged.maxFielding, counts.fielding);
            merged.maxThrowing = Math.max(merged.maxThrowing, counts.throwing);
            errorMultiplicity.set(playerId, merged);
        });
        if (fielding.passedBallBy)
            passedBalls.add(fielding.passedBallBy);
        doublePlay || (doublePlay = fielding.doublePlay === true);
        triplePlay || (triplePlay = fielding.triplePlay === true);
    });
    putouts.forEach((count, playerId) => credit(ensure(playerId, side), 'fielding', 'PO', count, eventId));
    assists.forEach((playerId) => credit(ensure(playerId, side), 'fielding', 'A', 1, eventId));
    let errorCredits = 0;
    errorMultiplicity.forEach(({ maxChainTotal, maxFielding, maxThrowing }, playerId) => {
        const playerErrorCredits = Math.max(maxChainTotal, maxFielding + maxThrowing);
        for (let count = 0; count < playerErrorCredits; count += 1) {
            credit(ensure(playerId, side), 'fielding', 'E', 1, eventId);
            errorCredits += 1;
        }
    });
    if (options.creditPassedBall !== false) {
        passedBalls.forEach((playerId) => credit(ensure(playerId, side), 'fielding', 'PB', 1, eventId));
    }
    const participants = new Set([...putouts.keys(), ...assists]);
    if (doublePlay)
        participants.forEach((playerId) => credit(ensure(playerId, side), 'fielding', 'DP', 1, eventId));
    if (triplePlay)
        participants.forEach((playerId) => credit(ensure(playerId, side), 'fielding', 'TP', 1, eventId));
    return { errorCredits, passedBallObserved: passedBalls.size > 0 };
}
function hasUnambiguousGroundBallEvidence(fieldings) {
    const observedBattedBalls = new Set(fieldings.flatMap((fielding) => (fielding.battedBall && fielding.battedBall !== 'unknown' ? [fielding.battedBall] : [])));
    return observedBattedBalls.size === 1 && observedBattedBalls.has('ground');
}
function atBatForResult(result) {
    return !['walk', 'intentional_walk', 'hit_by_pitch', 'sacrifice_bunt', 'sacrifice_fly', 'interference'].includes(result);
}
function collectAttachmentMaps(events) {
    const fielding = new Map();
    const judgments = new Map();
    events.forEach(({ event }, order) => {
        if (event.type === 'record_fielding') {
            const payload = event.payload;
            fielding.set(payload.playEventId, [...(fielding.get(payload.playEventId) ?? []), { order, value: payload.fielding }]);
        }
        if (event.type === 'record_scoring_judgment') {
            const payload = event.payload;
            judgments.set(payload.playEventId, [...(judgments.get(payload.playEventId) ?? []), { order, value: payload }]);
        }
    });
    return { fielding, judgments };
}
function attachmentsForPlay(attachments, event) {
    return [...new Set([event.sourceEventId, event.eventId])]
        .flatMap((eventId) => attachments.get(eventId) ?? [])
        .sort((left, right) => left.order - right.order)
        .map(({ value }) => value);
}
function latestJudgmentValue(judgments, runnerId, field) {
    for (let index = judgments.length - 1; index >= 0; index -= 1) {
        const judgment = judgments[index];
        if ((!judgment.runnerId || judgment.runnerId === runnerId) && judgment[field] !== undefined) {
            return judgment[field];
        }
    }
    return undefined;
}
function officialWinningSide(state) {
    if (state.lifecycle !== 'final')
        return null;
    if (state.finalizationReason?.kind === 'forfeit') {
        return state.gameEndDecision?.reason === 'forfeit' ? state.gameEndDecision.awardedSide : null;
    }
    if (state.score.home === state.score.away)
        return null;
    return state.score.home > state.score.away ? 'home' : 'away';
}
function exposedPitcherDecisionEventIds(events, finalState) {
    const winningSide = officialWinningSide(finalState);
    if (!winningSide)
        return new Set();
    const losingSide = winningSide === 'home' ? 'away' : 'home';
    const decisions = events.flatMap(({ event }) => {
        if (event.type !== 'record_scoring_judgment')
            return [];
        const pitcherOfRecord = event.payload.pitcherOfRecord;
        return pitcherOfRecord ? [{ eventId: event.eventId, value: pitcherOfRecord }] : [];
    });
    const byType = new Map();
    for (const { value } of decisions) {
        if (byType.has(value.decision))
            return new Set();
        byType.set(value.decision, value);
        const expectedSide = value.decision === 'loss' ? losingSide : winningSide;
        if (value.side !== expectedSide)
            return new Set();
    }
    const win = byType.get('win');
    const save = byType.get('save');
    if (win && save && win.playerId === save.playerId)
        return new Set();
    return new Set(decisions.map(({ eventId }) => eventId));
}
function projectDiamondStats(ledger) {
    const simulated = simulate(ledger);
    const coverage = (0, reducer_1.deriveDiamondCoverageFromEventStates)(ledger.initialState, simulated);
    const profile = (0, rules_1.requireDiamondRulesProfile)(ledger.rulesProfileId, ledger.rulesProfileVersion);
    const lines = new Map();
    const gameSeen = new Set();
    const starterSeen = new Set();
    const pitchingAppearanceSeen = new Set();
    const pitchingStartSeen = new Set();
    const teams = {
        home: {
            R: 0,
            H: 0,
            E: 0,
            LOB: 0,
            rispOpportunities: 0,
            rispHits: 0,
            twoOutRuns: 0,
            twoStrikePlateAppearances: 0,
            twoStrikeHits: 0,
            firstPitchStrikeOpportunities: 0,
            firstPitchStrikes: 0
        },
        away: {
            R: 0,
            H: 0,
            E: 0,
            LOB: 0,
            rispOpportunities: 0,
            rispHits: 0,
            twoOutRuns: 0,
            twoStrikePlateAppearances: 0,
            twoStrikeHits: 0,
            firstPitchStrikeOpportunities: 0,
            firstPitchStrikes: 0
        }
    };
    const attachments = collectAttachmentMaps(simulated);
    const exposedDecisionEventIds = exposedPitcherDecisionEventIds(simulated, ledger.state);
    // A runner whose home advance is explicitly nullified no longer occupies a
    // base, but still counts as left on base once this half officially closes.
    let pendingNullifiedHomeAdvances = 0;
    let physicalCauseCluster = null;
    const ensure = (playerId, side) => {
        const existing = lines.get(playerId);
        if (existing)
            return existing;
        const created = { playerId, side, raw: emptyRawStats(), sources: {} };
        lines.set(playerId, created);
        return created;
    };
    const credit = (line, family, stat, value, eventId) => {
        const familyRecord = line.raw[family];
        familyRecord[stat] = (familyRecord[stat] ?? 0) + value;
        const key = `${family}.${stat}`;
        if (!line.sources[key])
            line.sources[key] = new Set();
        line.sources[key].add(eventId);
    };
    const creditGame = (playerId, side, eventId, starter) => {
        const line = ensure(playerId, side);
        if (!gameSeen.has(playerId)) {
            credit(line, 'batting', 'G', 1, eventId);
            gameSeen.add(playerId);
        }
        if (starter && !starterSeen.has(playerId)) {
            credit(line, 'batting', 'GS', 1, eventId);
            starterSeen.add(playerId);
        }
    };
    const creditPitchingAppearance = (playerId, side, eventId, starter) => {
        const line = ensure(playerId, side);
        if (!pitchingAppearanceSeen.has(playerId)) {
            credit(line, 'pitching', 'APP', 1, eventId);
            pitchingAppearanceSeen.add(playerId);
        }
        if (starter && !pitchingStartSeen.has(playerId)) {
            credit(line, 'pitching', 'GS', 1, eventId);
            pitchingStartSeen.add(playerId);
        }
    };
    simulated.forEach(({ event, before }) => {
        const eventId = event.eventId;
        if (event.type !== 'advance_runner' && event.type !== 'record_plate_appearance')
            physicalCauseCluster = null;
        switch (event.type) {
            case 'start': {
                ['home', 'away'].forEach((side) => {
                    before.lineups[side].battingOrder.forEach((slot) => creditGame(slot.activePlayerId, side, eventId, true));
                    Object.values(before.lineups[side].defense).forEach((playerId) => {
                        if (playerId)
                            creditGame(playerId, side, eventId, true);
                    });
                    const pitcherId = before.lineups[side].defense.P;
                    if (pitcherId)
                        creditPitchingAppearance(pitcherId, side, eventId, true);
                });
                break;
            }
            case 'substitute': {
                const payload = event.payload;
                creditGame(payload.incomingPlayerId, payload.side, eventId, false);
                const entersAsPitcher = payload.defensivePosition === 'P' || before.lineups[payload.side].defense.P === payload.outgoingPlayerId;
                if (entersAsPitcher && isOpenDefensiveEntry(before, payload.side)) {
                    creditPitchingAppearance(payload.incomingPlayerId, payload.side, eventId, false);
                    const inherited = [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length;
                    if (inherited > 0) {
                        credit(ensure(payload.incomingPlayerId, payload.side), 'pitching', 'inheritedRunners', inherited, eventId);
                    }
                }
                break;
            }
            case 're_enter': {
                const payload = event.payload;
                creditGame(payload.starterPlayerId, payload.side, eventId, false);
                const entersAsPitcher = payload.defensivePosition === 'P' || before.lineups[payload.side].defense.P === payload.replacedPlayerId;
                if (entersAsPitcher && isOpenDefensiveEntry(before, payload.side)) {
                    creditPitchingAppearance(payload.starterPlayerId, payload.side, eventId, false);
                    const inherited = [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length;
                    if (inherited > 0) {
                        credit(ensure(payload.starterPlayerId, payload.side), 'pitching', 'inheritedRunners', inherited, eventId);
                    }
                }
                break;
            }
            case 'set_defensive_alignment': {
                const payload = event.payload;
                const priorPitcherId = before.lineups[payload.side].defense.P;
                const incomingPitcherId = payload.assignments.find((assignment) => assignment.position === 'P')?.playerId;
                if (incomingPitcherId && incomingPitcherId !== priorPitcherId && isOpenDefensiveEntry(before, payload.side)) {
                    creditPitchingAppearance(incomingPitcherId, payload.side, eventId, false);
                    const inherited = [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length;
                    if (inherited > 0) {
                        credit(ensure(incomingPitcherId, payload.side), 'pitching', 'inheritedRunners', inherited, eventId);
                    }
                }
                break;
            }
            case 'record_pitch': {
                const payload = event.payload;
                const pitchingSide = before.inning.half === 'top' ? 'home' : 'away';
                const pitcher = ensure(payload.pitcherId, pitchingSide);
                creditPitchingAppearance(payload.pitcherId, pitchingSide, eventId, false);
                if ((0, reducer_1.isDiamondDeliveredPitch)(payload.result)) {
                    credit(pitcher, 'pitching', 'pitches', 1, eventId);
                    if (isStrikePitch(payload.result))
                        credit(pitcher, 'pitching', 'strikes', 1, eventId);
                    if (before.inning.pitchesInPlateAppearance === 0) {
                        teams[pitchingSide].firstPitchStrikeOpportunities += 1;
                        if (isStrikePitch(payload.result)) {
                            credit(pitcher, 'pitching', 'firstPitchStrikes', 1, eventId);
                            teams[pitchingSide].firstPitchStrikes += 1;
                        }
                    }
                }
                const alreadyCreditedPitchingInfraction = payload.result === 'balk' || payload.result === 'illegal_pitch';
                if (alreadyCreditedPitchingInfraction) {
                    credit(pitcher, 'pitching', 'balkIllegalPitch', 1, eventId);
                }
                // A following set of independent runner moves can cite the same physical
                // pitch. Without this pitch anchor, consecutive advance commands remain
                // separate plays because the schema contains no trustworthy group ID.
                physicalCauseCluster = {
                    cause: alreadyCreditedPitchingInfraction ? payload.result : null,
                    pitcherId: payload.pitcherId,
                    anchoredByPitch: true,
                    pitchingCreditRecorded: alreadyCreditedPitchingInfraction,
                    passedBallCreditRecorded: false
                };
                break;
            }
            case 'record_plate_appearance': {
                const payload = event.payload;
                const battingSide = battingSideFor(before);
                const pitchingSide = battingSide === 'home' ? 'away' : 'home';
                const batter = ensure(payload.batterId, battingSide);
                const pitcher = ensure(payload.pitcherId, pitchingSide);
                const currentPitcherId = before.lineups[pitchingSide].defense.P ?? payload.pitcherId;
                const fieldingChains = [...(payload.fielding ? [payload.fielding] : []), ...attachmentsForPlay(attachments.fielding, event)];
                creditGame(payload.batterId, battingSide, eventId, false);
                creditPitchingAppearance(payload.pitcherId, pitchingSide, eventId, false);
                credit(batter, 'batting', 'PA', 1, eventId);
                credit(pitcher, 'pitching', 'BF', 1, eventId);
                if (atBatForResult(payload.result))
                    credit(batter, 'batting', 'AB', 1, eventId);
                const hitBases = {
                    single: 1,
                    double: 2,
                    triple: 3,
                    home_run: 4
                };
                const bases = hitBases[payload.result];
                if (bases) {
                    credit(batter, 'batting', 'H', 1, eventId);
                    credit(batter, 'batting', bases === 4 ? 'HR' : `${String(bases)}B`, 1, eventId);
                    credit(batter, 'batting', 'TB', bases, eventId);
                    credit(pitcher, 'pitching', 'H', 1, eventId);
                    teams[battingSide].H += 1;
                    if (payload.result === 'home_run')
                        credit(pitcher, 'pitching', 'HR', 1, eventId);
                }
                if (payload.result === 'walk' || payload.result === 'intentional_walk') {
                    credit(batter, 'batting', payload.result === 'walk' ? 'BB' : 'IBB', 1, eventId);
                    credit(pitcher, 'pitching', payload.result === 'walk' ? 'BB' : 'IBB', 1, eventId);
                }
                if (payload.result === 'hit_by_pitch') {
                    credit(batter, 'batting', 'HBP', 1, eventId);
                    credit(pitcher, 'pitching', 'HBP', 1, eventId);
                }
                if (payload.result === 'strikeout' || payload.result === 'dropped_third_strike') {
                    credit(batter, 'batting', 'SO', 1, eventId);
                    credit(pitcher, 'pitching', 'SO', 1, eventId);
                }
                if (payload.result === 'sacrifice_fly')
                    credit(batter, 'batting', 'SF', 1, eventId);
                if (payload.result === 'sacrifice_bunt')
                    credit(batter, 'batting', 'SH', 1, eventId);
                if (payload.result === 'reached_on_error')
                    credit(batter, 'batting', 'ROE', 1, eventId);
                if (payload.result === 'fielders_choice')
                    credit(batter, 'batting', 'FC', 1, eventId);
                if (payload.result === 'double_play' && hasUnambiguousGroundBallEvidence(fieldingChains)) {
                    credit(batter, 'batting', 'GIDP', 1, eventId);
                }
                const hasRisp = Boolean(before.bases.second || before.bases.third);
                if (hasRisp)
                    teams[battingSide].rispOpportunities += 1;
                if (hasRisp && bases)
                    teams[battingSide].rispHits += 1;
                if (before.inning.strikes >= 2) {
                    teams[battingSide].twoStrikePlateAppearances += 1;
                    if (bases)
                        teams[battingSide].twoStrikeHits += 1;
                }
                const allAdvances = [{ runnerId: payload.batterId, from: 'batter', ...payload.batterAdvance }, ...payload.runnerAdvances];
                pendingNullifiedHomeAdvances += allAdvances.filter((advance) => advance.to === 'home' && advance.countsRun === false).length;
                let runsOnPlay = 0;
                allAdvances.forEach((advance) => {
                    if (advance.from !== 'batter') {
                        const runner = ensure(advance.runnerId, battingSide);
                        if (advance.to === 'out')
                            credit(runner, 'baserunning', 'outs', 1, eventId);
                        else if (advance.to !== 'stay')
                            credit(runner, 'baserunning', 'advances', 1, eventId);
                        if (advance.cause === 'stolen_base')
                            credit(runner, 'baserunning', 'SB', 1, eventId);
                        if (advance.cause === 'caught_stealing')
                            credit(runner, 'baserunning', 'CS', 1, eventId);
                        if (advance.cause === 'pickoff')
                            credit(runner, 'baserunning', 'pickoffs', 1, eventId);
                    }
                    if (advance.to !== 'home' || advance.countsRun === false)
                        return;
                    runsOnPlay += 1;
                    const runner = ensure(advance.runnerId, battingSide);
                    creditGame(advance.runnerId, battingSide, eventId, false);
                    credit(runner, 'batting', 'R', 1, eventId);
                    const placement = advance.from === 'batter' ? null : before.bases[advance.from];
                    const matchingJudgments = attachmentsForPlay(attachments.judgments, event).filter((candidate) => !candidate.runnerId || candidate.runnerId === advance.runnerId);
                    const responsiblePitcherId = latestJudgmentValue(matchingJudgments, advance.runnerId, 'responsiblePitcherId') ??
                        advance.responsiblePitcherId ??
                        (advance.from === 'batter' ? payload.pitcherId : placement?.chargedToPitcherId);
                    const earned = latestJudgmentValue(matchingJudgments, advance.runnerId, 'earned') ?? advance.earned;
                    if (responsiblePitcherId) {
                        const responsiblePitcher = ensure(responsiblePitcherId, pitchingSide);
                        creditPitchingAppearance(responsiblePitcherId, pitchingSide, eventId, false);
                        credit(responsiblePitcher, 'pitching', 'R', 1, eventId);
                        if (currentPitcherId !== responsiblePitcherId) {
                            credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'inheritedScored', 1, eventId);
                        }
                        if (earned === true)
                            credit(responsiblePitcher, 'pitching', 'ER', 1, eventId);
                    }
                    const rbi = latestJudgmentValue(matchingJudgments, advance.runnerId, 'rbi') ?? advance.rbi;
                    if (payload.runsBattedIn === undefined && rbi === true)
                        credit(batter, 'batting', 'RBI', 1, eventId);
                });
                if (payload.runsBattedIn !== undefined) {
                    credit(batter, 'batting', 'RBI', payload.runsBattedIn, eventId);
                }
                const physicalCauses = new Set(allAdvances.map((advance) => advance.cause));
                if (physicalCauses.has('wild_pitch'))
                    credit(pitcher, 'pitching', 'WP', 1, eventId);
                if (physicalCauses.has('balk') || physicalCauses.has('illegal_pitch')) {
                    const matchingPriorCredit = physicalCauseCluster?.pitcherId === payload.pitcherId &&
                        (physicalCauseCluster.cause === 'balk' || physicalCauseCluster.cause === 'illegal_pitch') &&
                        physicalCauseCluster.pitchingCreditRecorded;
                    if (!matchingPriorCredit)
                        credit(pitcher, 'pitching', 'balkIllegalPitch', 1, eventId);
                }
                credit(pitcher, 'pitching', 'outs', payload.outsOnPlay, eventId);
                teams[battingSide].R += runsOnPlay;
                if (before.inning.outs === 2)
                    teams[battingSide].twoOutRuns += runsOnPlay;
                const defenders = new Set(Object.values(before.lineups[pitchingSide].defense).filter(Boolean));
                defenders.forEach((playerId) => credit(ensure(playerId, pitchingSide), 'fielding', 'defensiveOuts', payload.outsOnPlay, eventId));
                const fieldingResult = addMergedFielding(fieldingChains, payload.outsOnPlay, pitchingSide, eventId, ensure, credit);
                teams[pitchingSide].E += fieldingResult.errorCredits;
                physicalCauseCluster = null;
                break;
            }
            case 'advance_runner': {
                const payload = event.payload;
                const battingSide = battingSideFor(before);
                const pitchingSide = battingSide === 'home' ? 'away' : 'home';
                const runner = ensure(payload.runnerId, battingSide);
                creditGame(payload.runnerId, battingSide, eventId, false);
                if (payload.to === 'out')
                    credit(runner, 'baserunning', 'outs', 1, eventId);
                else if (payload.to !== 'stay')
                    credit(runner, 'baserunning', 'advances', 1, eventId);
                if (payload.to === 'home' && payload.countsRun === false)
                    pendingNullifiedHomeAdvances += 1;
                if (payload.cause === 'stolen_base')
                    credit(runner, 'baserunning', 'SB', 1, eventId);
                if (payload.cause === 'caught_stealing')
                    credit(runner, 'baserunning', 'CS', 1, eventId);
                if (payload.cause === 'pickoff')
                    credit(runner, 'baserunning', 'pickoffs', 1, eventId);
                const placement = before.bases[payload.from];
                const matchingJudgments = attachmentsForPlay(attachments.judgments, event).filter((candidate) => !candidate.runnerId || candidate.runnerId === payload.runnerId);
                const responsiblePitcherId = latestJudgmentValue(matchingJudgments, payload.runnerId, 'responsiblePitcherId') ??
                    payload.responsiblePitcherId ??
                    placement?.chargedToPitcherId;
                const currentPitcherId = before.lineups[pitchingSide].defense.P;
                const physicalCause = ['wild_pitch', 'passed_ball', 'balk', 'illegal_pitch'].includes(payload.cause)
                    ? payload.cause
                    : null;
                const sharesAnchoredPitch = Boolean(physicalCause &&
                    physicalCauseCluster?.anchoredByPitch &&
                    physicalCauseCluster.pitcherId === (currentPitcherId ?? null) &&
                    (physicalCauseCluster.cause === null || physicalCauseCluster.cause === physicalCause));
                if (!physicalCause) {
                    physicalCauseCluster = null;
                }
                else if (!sharesAnchoredPitch) {
                    physicalCauseCluster = {
                        cause: physicalCause,
                        pitcherId: currentPitcherId ?? null,
                        anchoredByPitch: false,
                        pitchingCreditRecorded: false,
                        passedBallCreditRecorded: false
                    };
                }
                else if (physicalCauseCluster?.cause === null) {
                    physicalCauseCluster.cause = physicalCause;
                }
                if (payload.to === 'out' && currentPitcherId) {
                    credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'outs', 1, eventId);
                    const defenders = new Set(Object.values(before.lineups[pitchingSide].defense).filter(Boolean));
                    defenders.forEach((playerId) => credit(ensure(playerId, pitchingSide), 'fielding', 'defensiveOuts', 1, eventId));
                }
                if (payload.to === 'home' && payload.countsRun !== false) {
                    credit(runner, 'batting', 'R', 1, eventId);
                    teams[battingSide].R += 1;
                    if (before.inning.outs === 2)
                        teams[battingSide].twoOutRuns += 1;
                    if (responsiblePitcherId) {
                        const responsiblePitcher = ensure(responsiblePitcherId, pitchingSide);
                        credit(responsiblePitcher, 'pitching', 'R', 1, eventId);
                        const earned = latestJudgmentValue(matchingJudgments, payload.runnerId, 'earned') ?? payload.earned;
                        if (earned === true)
                            credit(responsiblePitcher, 'pitching', 'ER', 1, eventId);
                        if (currentPitcherId && currentPitcherId !== responsiblePitcherId) {
                            credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'inheritedScored', 1, eventId);
                        }
                    }
                }
                if (currentPitcherId && payload.cause === 'wild_pitch' && !physicalCauseCluster?.pitchingCreditRecorded) {
                    credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'WP', 1, eventId);
                    if (physicalCauseCluster)
                        physicalCauseCluster.pitchingCreditRecorded = true;
                }
                if (currentPitcherId &&
                    (payload.cause === 'balk' || payload.cause === 'illegal_pitch') &&
                    !physicalCauseCluster?.pitchingCreditRecorded) {
                    credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'balkIllegalPitch', 1, eventId);
                    if (physicalCauseCluster)
                        physicalCauseCluster.pitchingCreditRecorded = true;
                }
                const fieldingResult = addMergedFielding([...(payload.fielding ? [payload.fielding] : []), ...attachmentsForPlay(attachments.fielding, event)], payload.to === 'out' ? 1 : 0, pitchingSide, eventId, ensure, credit, { creditPassedBall: !physicalCauseCluster?.passedBallCreditRecorded });
                if (fieldingResult.passedBallObserved && physicalCauseCluster)
                    physicalCauseCluster.passedBallCreditRecorded = true;
                teams[pitchingSide].E += fieldingResult.errorCredits;
                break;
            }
            case 'add_courtesy_runner': {
                const payload = event.payload;
                creditGame(payload.runnerId, payload.side, eventId, false);
                break;
            }
            case 'record_fielding': {
                // Attached to and credited with its original play above.
                break;
            }
            case 'record_scoring_judgment': {
                const payload = event.payload;
                if (payload.pitcherOfRecord && exposedDecisionEventIds.has(eventId)) {
                    const decision = payload.pitcherOfRecord.decision === 'win' ? 'W' : payload.pitcherOfRecord.decision === 'loss' ? 'L' : 'SV';
                    credit(ensure(payload.pitcherOfRecord.playerId, payload.pitcherOfRecord.side), 'pitching', decision, 1, eventId);
                }
                break;
            }
            case 'advance_half_inning': {
                const side = battingSideFor(before);
                teams[side].LOB +=
                    [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length + pendingNullifiedHomeAdvances;
                pendingNullifiedHomeAdvances = 0;
                break;
            }
            case 'finalize': {
                if (ledger.state.lifecycle === 'final' && event.revision === ledger.state.finalConfirmedAtRevision) {
                    const side = battingSideFor(before);
                    teams[side].LOB +=
                        [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length + pendingNullifiedHomeAdvances;
                    pendingNullifiedHomeAdvances = 0;
                }
                break;
            }
            default:
                break;
        }
    });
    const players = Object.fromEntries(Array.from(lines.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([playerId, line]) => [
        playerId,
        {
            playerId,
            side: line.side,
            raw: line.raw,
            derived: deriveDiamondPlayerStats(line.raw, coverage, profile.eraInningsBasis),
            coverage,
            sources: Object.fromEntries(Object.entries(line.sources).map(([stat, sourceIds]) => [stat, Array.from(sourceIds).sort()]))
        }
    ]));
    return {
        schemaVersion: 2,
        catalogVersion: 1,
        sourceRevision: ledger.state.revision,
        checkpointHash: ledger.state.checkpointHash,
        coverage,
        players,
        teams,
        inningLines: ledger.state.inningRuns,
        complete: true
    };
}
function isBattingQualified(line, teamGames, plateAppearancesPerGame = 2.1) {
    return (line.coverage.batting === 'complete' &&
        Number.isFinite(teamGames) &&
        teamGames > 0 &&
        line.raw.batting.PA >= teamGames * plateAppearancesPerGame);
}
