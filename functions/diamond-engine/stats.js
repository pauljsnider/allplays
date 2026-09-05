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
function asAction(event) {
    return { type: event.type, payload: event.payload, eventId: event.eventId };
}
function simulate(ledger) {
    const result = [];
    let state = ledger.initialState;
    (0, ledger_1.getEffectiveDiamondEvents)(ledger.events).forEach((event) => {
        result.push({ event, before: state });
        state = (0, reducer_1.reduceDiamondEvent)(state, asAction(event));
        state = (0, reducer_1.setDiamondStateRevision)(state, event.revision);
    });
    return result;
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
    const battingDenominator = raw.batting.AB + raw.batting.BB + raw.batting.HBP + raw.batting.SF;
    const battingComplete = coverage.batting === 'complete';
    const baserunningComplete = coverage.baserunning === 'complete';
    const pitchingComplete = coverage.pitching === 'complete';
    const pitchComplete = coverage.pitches === 'complete';
    const fieldingComplete = coverage.fielding === 'complete';
    const average = battingComplete ? safeRatio(raw.batting.H, raw.batting.AB) : null;
    const obp = battingComplete ? safeRatio(raw.batting.H + raw.batting.BB + raw.batting.HBP, battingDenominator) : null;
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
function addFielding(fielding, side, eventId, ensure, credit) {
    if (!fielding)
        return;
    if (fielding.putoutBy)
        credit(ensure(fielding.putoutBy, side), 'fielding', 'PO', 1, eventId);
    (fielding.assists ?? []).forEach((playerId) => credit(ensure(playerId, side), 'fielding', 'A', 1, eventId));
    (fielding.errors ?? []).forEach(({ playerId }) => credit(ensure(playerId, side), 'fielding', 'E', 1, eventId));
    if (fielding.passedBallBy)
        credit(ensure(fielding.passedBallBy, side), 'fielding', 'PB', 1, eventId);
    const participants = new Set([...(fielding.putoutBy ? [fielding.putoutBy] : []), ...(fielding.assists ?? [])]);
    if (fielding.doublePlay) {
        participants.forEach((playerId) => credit(ensure(playerId, side), 'fielding', 'DP', 1, eventId));
    }
    if (fielding.triplePlay) {
        participants.forEach((playerId) => credit(ensure(playerId, side), 'fielding', 'TP', 1, eventId));
    }
}
function atBatForResult(result) {
    return !['walk', 'intentional_walk', 'hit_by_pitch', 'sacrifice_bunt', 'sacrifice_fly', 'interference'].includes(result);
}
function collectAttachmentMaps(events) {
    const fielding = new Map();
    const judgments = new Map();
    events.forEach(({ event }) => {
        if (event.type === 'record_fielding') {
            const payload = event.payload;
            fielding.set(payload.playEventId, [...(fielding.get(payload.playEventId) ?? []), payload.fielding]);
        }
        if (event.type === 'record_scoring_judgment') {
            const payload = event.payload;
            judgments.set(payload.playEventId, [...(judgments.get(payload.playEventId) ?? []), payload]);
        }
    });
    return { fielding, judgments };
}
function projectDiamondStats(ledger) {
    const simulated = simulate(ledger);
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
                if (entersAsPitcher) {
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
                if (entersAsPitcher) {
                    creditPitchingAppearance(payload.starterPlayerId, payload.side, eventId, false);
                    const inherited = [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length;
                    if (inherited > 0) {
                        credit(ensure(payload.starterPlayerId, payload.side), 'pitching', 'inheritedRunners', inherited, eventId);
                    }
                }
                break;
            }
            case 'record_pitch': {
                const payload = event.payload;
                const pitchingSide = before.inning.half === 'top' ? 'home' : 'away';
                const pitcher = ensure(payload.pitcherId, pitchingSide);
                creditPitchingAppearance(payload.pitcherId, pitchingSide, eventId, false);
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
                if (payload.result === 'balk' || payload.result === 'illegal_pitch') {
                    credit(pitcher, 'pitching', 'balkIllegalPitch', 1, eventId);
                }
                break;
            }
            case 'record_plate_appearance': {
                const payload = event.payload;
                const battingSide = battingSideFor(before);
                const pitchingSide = battingSide === 'home' ? 'away' : 'home';
                const batter = ensure(payload.batterId, battingSide);
                const pitcher = ensure(payload.pitcherId, pitchingSide);
                const currentPitcherId = before.lineups[pitchingSide].defense.P ?? payload.pitcherId;
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
                    credit(batter, 'batting', `${String(bases)}B`, 1, eventId);
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
                if (payload.result === 'double_play')
                    credit(batter, 'batting', 'GIDP', 1, eventId);
                const hasRisp = Boolean(before.bases.second || before.bases.third);
                if (hasRisp)
                    teams[battingSide].rispOpportunities += 1;
                if (hasRisp && bases)
                    teams[battingSide].rispHits += 1;
                if (before.inning.strikes === 2) {
                    teams[battingSide].twoStrikePlateAppearances += 1;
                    if (bases)
                        teams[battingSide].twoStrikeHits += 1;
                }
                const allAdvances = [{ runnerId: payload.batterId, from: 'batter', ...payload.batterAdvance }, ...payload.runnerAdvances];
                let runsOnPlay = 0;
                allAdvances.forEach((advance) => {
                    if (advance.from !== 'batter') {
                        const runner = ensure(advance.runnerId, battingSide);
                        credit(runner, 'baserunning', advance.to === 'out' ? 'outs' : 'advances', 1, eventId);
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
                    const matchingJudgments = (attachments.judgments.get(event.sourceEventId) ??
                        attachments.judgments.get(event.eventId) ??
                        []).filter((candidate) => !candidate.runnerId || candidate.runnerId === advance.runnerId);
                    const judgment = matchingJudgments.length ? matchingJudgments[matchingJudgments.length - 1] : undefined;
                    const responsiblePitcherId = judgment?.responsiblePitcherId ?? advance.responsiblePitcherId ?? placement?.chargedToPitcherId ?? payload.pitcherId;
                    const responsiblePitcher = ensure(responsiblePitcherId, pitchingSide);
                    creditPitchingAppearance(responsiblePitcherId, pitchingSide, eventId, false);
                    credit(responsiblePitcher, 'pitching', 'R', 1, eventId);
                    if (currentPitcherId !== responsiblePitcherId) {
                        credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'inheritedScored', 1, eventId);
                    }
                    const earned = judgment?.earned ?? advance.earned;
                    if (earned === true)
                        credit(responsiblePitcher, 'pitching', 'ER', 1, eventId);
                    const rbi = judgment?.rbi ?? advance.rbi;
                    if (payload.runsBattedIn === undefined && rbi === true)
                        credit(batter, 'batting', 'RBI', 1, eventId);
                });
                if (payload.runsBattedIn !== undefined) {
                    credit(batter, 'batting', 'RBI', payload.runsBattedIn, eventId);
                }
                credit(pitcher, 'pitching', 'outs', payload.outsOnPlay, eventId);
                teams[battingSide].R += runsOnPlay;
                if (before.inning.outs === 2)
                    teams[battingSide].twoOutRuns += runsOnPlay;
                const defenders = new Set(Object.values(before.lineups[pitchingSide].defense).filter(Boolean));
                defenders.forEach((playerId) => credit(ensure(playerId, pitchingSide), 'fielding', 'defensiveOuts', payload.outsOnPlay, eventId));
                addFielding(payload.fielding, pitchingSide, eventId, ensure, credit);
                (attachments.fielding.get(event.sourceEventId) ?? attachments.fielding.get(event.eventId) ?? []).forEach((fielding) => {
                    addFielding(fielding, pitchingSide, eventId, ensure, credit);
                    (fielding.errors ?? []).forEach(() => {
                        teams[pitchingSide].E += 1;
                    });
                });
                (payload.fielding?.errors ?? []).forEach(() => {
                    teams[pitchingSide].E += 1;
                });
                break;
            }
            case 'advance_runner': {
                const payload = event.payload;
                const battingSide = battingSideFor(before);
                const pitchingSide = battingSide === 'home' ? 'away' : 'home';
                const runner = ensure(payload.runnerId, battingSide);
                creditGame(payload.runnerId, battingSide, eventId, false);
                credit(runner, 'baserunning', payload.to === 'out' ? 'outs' : 'advances', 1, eventId);
                if (payload.cause === 'stolen_base')
                    credit(runner, 'baserunning', 'SB', 1, eventId);
                if (payload.cause === 'caught_stealing')
                    credit(runner, 'baserunning', 'CS', 1, eventId);
                if (payload.cause === 'pickoff')
                    credit(runner, 'baserunning', 'pickoffs', 1, eventId);
                const placement = before.bases[payload.from];
                const responsiblePitcherId = payload.responsiblePitcherId ?? placement?.chargedToPitcherId;
                const currentPitcherId = before.lineups[pitchingSide].defense.P;
                if (payload.to === 'home' && payload.countsRun !== false) {
                    credit(runner, 'batting', 'R', 1, eventId);
                    teams[battingSide].R += 1;
                    if (before.inning.outs === 2)
                        teams[battingSide].twoOutRuns += 1;
                    if (responsiblePitcherId) {
                        const responsiblePitcher = ensure(responsiblePitcherId, pitchingSide);
                        credit(responsiblePitcher, 'pitching', 'R', 1, eventId);
                        if (payload.earned === true)
                            credit(responsiblePitcher, 'pitching', 'ER', 1, eventId);
                        if (currentPitcherId && currentPitcherId !== responsiblePitcherId) {
                            credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'inheritedScored', 1, eventId);
                        }
                    }
                }
                if (currentPitcherId && payload.cause === 'wild_pitch') {
                    credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'WP', 1, eventId);
                }
                if (currentPitcherId && (payload.cause === 'balk' || payload.cause === 'illegal_pitch')) {
                    credit(ensure(currentPitcherId, pitchingSide), 'pitching', 'balkIllegalPitch', 1, eventId);
                }
                addFielding(payload.fielding, pitchingSide, eventId, ensure, credit);
                (payload.fielding?.errors ?? []).forEach(() => {
                    teams[pitchingSide].E += 1;
                });
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
                if (payload.pitcherOfRecord) {
                    const decision = payload.pitcherOfRecord.decision === 'win' ? 'W' : payload.pitcherOfRecord.decision === 'loss' ? 'L' : 'SV';
                    credit(ensure(payload.pitcherOfRecord.playerId, payload.pitcherOfRecord.side), 'pitching', decision, 1, eventId);
                }
                break;
            }
            case 'advance_half_inning': {
                const side = battingSideFor(before);
                teams[side].LOB += [before.bases.first, before.bases.second, before.bases.third].filter(Boolean).length;
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
            derived: deriveDiamondPlayerStats(line.raw, ledger.state.coverage, profile.eraInningsBasis),
            coverage: ledger.state.coverage,
            sources: Object.fromEntries(Object.entries(line.sources).map(([stat, sourceIds]) => [stat, Array.from(sourceIds).sort()]))
        }
    ]));
    return {
        schemaVersion: 2,
        catalogVersion: 1,
        sourceRevision: ledger.state.revision,
        checkpointHash: ledger.state.checkpointHash,
        coverage: ledger.state.coverage,
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
