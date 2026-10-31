'use strict';
function number(value, fallback = 0) {
    const result = value && typeof value.toMillis === 'function' ? value.toMillis() : Number(value);
    return Number.isFinite(result) ? result : fallback;
}
function fail(message) { const error = new Error(message); error.status = 409; throw error; }
function periods(sport) {
    switch (String(sport || '').toLowerCase()) {
        case 'soccer': return ['H1', 'H2', 'OT'];
        case 'hockey': return ['P1', 'P2', 'P3', 'OT', 'SO'];
        case 'baseball': case 'softball': return ['T1','B1','T2','B2','T3','B3','T4','B4','T5','B5','T6','B6','T7','B7'];
        case 'volleyball': return ['Set 1','Set 2','Set 3','Set 4','Set 5'];
        default: return ['Q1', 'Q2', 'Q3', 'Q4', 'OT'];
    }
}
function snapshot(game, now, sport) {
    const base = Math.max(0, number(game.liveClockMs));
    const running = game.liveClockRunning === true;
    return {
        homeScore: Math.max(0, number(game.homeScore)),
        awayScore: Math.max(0, number(game.awayScore)),
        liveClockMs: base + (running ? Math.max(0, now - number(game.liveClockUpdatedAt ?? now, now)) : 0),
        liveClockRunning: running,
        liveClockPeriod: game.liveClockPeriod || periods(sport)[0],
        liveClockUpdatedAt: now,
        liveStatus: game.liveStatus || 'scheduled'
    };
}
function apply(game, control, command, now, sport) {
    if (command.revision !== (control.revision || 0)) fail('Score changed. Refresh before sending another command.');
    const before = snapshot(game, now, sport);
    let next = { ...before };
    let history = [...(control.history || [])];
    let type = 'clock_sync';
    if (command.action === 'score') {
        if (!['homeScore', 'awayScore'].includes(command.side) || ![-1, 1, 2, 3].includes(command.delta)) fail('Invalid score command.');
        if (next[command.side] + command.delta < 0 || next[command.side] + command.delta > 999) fail('Score must be between 0 and 999.');
        next[command.side] += command.delta;
    } else if (command.action === 'clock') {
        if (typeof command.running !== 'boolean') fail('Choose Start or Pause.');
        next.liveClockRunning = command.running;
        next.liveStatus = 'live';
        type = command.running ? 'clock_start' : 'clock_pause';
    } else if (command.action === 'period') {
        if (!periods(sport).includes(command.period)) fail('Invalid period.');
        next.liveClockPeriod = command.period;
        next.liveClockRunning = false;
        type = 'period_change';
    } else if (command.action === 'undo') {
        if (!history.length) fail('Nothing to undo.');
        const previous = history.pop();
        // Undo scores/periods without rewinding time elapsed since the action.
        if (previous.action === 'score') {
            next[previous.side] = previous.before[previous.side];
        } else if (previous.action === 'clock') {
            next.liveClockRunning = previous.before.liveClockRunning;
            next.liveStatus = previous.before.liveStatus;
        } else if (previous.action === 'period') {
            next.liveClockPeriod = previous.before.liveClockPeriod;
            next.liveClockRunning = previous.before.liveClockRunning;
        }
        type = next.liveClockRunning ? 'clock_start' : 'clock_pause';
    } else { fail('Unknown command.'); }
    if (command.action !== 'undo') history = [...history, { action: command.action, side: command.side || '', before }].slice(-30);
    return { next, control: { ...control, revision: (control.revision || 0) + 1, history }, type };
}
module.exports = { periods, snapshot, apply };
