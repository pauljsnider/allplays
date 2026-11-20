import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
function harness({ current = true, fail = false } = {}) {
    const getAllUsers = vi.fn(async () => { if (fail) throw new Error('offline'); return [{ id: 'legacy' }]; });
    const render = vi.fn();
    const start = source.indexOf('async function loadAdditionalTeamMembers(button)');
    const end = source.indexOf('function getSelectedPermissionIds', start);
    const api = new Function('getAllUsers', 'renderScorekeeperGrantControls', 'isCurrent', `
        let currentTeamMemberUsers = [], teamMemberDiscoveryState = 'idle';
        let currentTeam = {}, currentPlayers = [];
        const captureTeamAuthContext = () => ({});
        const isButtonFromTeamContext = () => true;
        const isTeamAuthContextCurrent = () => isCurrent();
        ${source.slice(start, end)}
        return { loadAdditionalTeamMembers, state: () => ({users: currentTeamMemberUsers, status: teamMemberDiscoveryState}) };
    `)(getAllUsers, render, () => current);
    return { ...api, getAllUsers, render, invalidate: () => { current = false; } };
}
describe('team admin initial loading', () => {
    it('does not scan users during team load, regardless of global user count', () => {
        const load = source.slice(source.indexOf('async function loadTeam('), source.indexOf('async function getAllEvents('));
        expect(load).not.toContain('getAllUsers(');
        expect(load).not.toContain('loadScorekeeperGrantUsers(');
        expect(load).toContain('renderScorekeeperGrantControls(team, players)');
    });
    it('only discovers legacy users after an authorized explicit request', async () => {
        const h = harness();
        expect(h.getAllUsers).not.toHaveBeenCalled();
        await h.loadAdditionalTeamMembers({ disabled: false });
        expect(h.getAllUsers).toHaveBeenCalledTimes(1);
        expect(h.state()).toEqual({users: [{id:'legacy'}], status:'complete'});
    });
    it('does not load for an obsolete or unauthorized context', async () => {
        const h = harness({ current: false });
        await h.loadAdditionalTeamMembers({disabled:false});
        expect(h.getAllUsers).not.toHaveBeenCalled();
    });
    it('retains retryable failure instead of claiming complete emptiness', async () => {
        const h = harness({ fail:true });
        await h.loadAdditionalTeamMembers({disabled:false});
        expect(h.state().status).toBe('error');
        expect(source).toContain('Could not check additional accounts. Retry');
    });
    it('ignores response after auth context changes', async () => {
        const h = harness();
        const pending = h.loadAdditionalTeamMembers({disabled:false});
        h.invalidate();
        await pending;
        expect(h.state().users).toEqual([]);
        expect(h.state().status).not.toBe('complete');
    });
});

it('checks context before a queued schedule worker issues any reads', () => {
    const worker = source.slice(source.indexOf('const enrichedEvents = await boundedMap'), source.indexOf('allEvents.push(...enrichedEvents'));
    expect(worker.indexOf('if (!isContextCurrent()) return null;')).toBeLessThan(worker.indexOf('await getRsvps'));
});
