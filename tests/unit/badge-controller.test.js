// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ checkAuth: vi.fn(), getUserTeamsWithAccess: vi.fn(), getGames: vi.fn(), configure: vi.fn() }));
vi.mock('../../js/auth.js?v=10', () => ({ checkAuth: mocks.checkAuth }));
vi.mock('../../js/db.js?v=14', () => ({ getUserTeamsWithAccess: mocks.getUserTeamsWithAccess, getGames: mocks.getGames }));
vi.mock('../../js/firebase.js?v=4433195', () => ({ functions: {}, httpsCallable: () => mocks.configure }));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();
    document.body.innerHTML = readFileSync('badge-controller.html', 'utf8');
    mocks.getUserTeamsWithAccess.mockResolvedValue([{ id: 't', name: '<Falcons>' }]);
    mocks.getGames.mockResolvedValue([{ id: 'g', opponent: 'Owls', badgeScoreControl: true }, { id: 'free', opponent: 'Other' }]);
    mocks.configure.mockResolvedValue({ data: {} });
    URL.createObjectURL = vi.fn(() => 'blob:local-test'); URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await import('../../js/badge-controller.js');
});
it('signed-out boot provides sign-in and never enables pairing', async () => {
    await mocks.checkAuth.mock.calls[0][0](null);
    expect(document.querySelector('#status a').getAttribute('href')).toBe('login.html');
    expect(document.querySelector('#pair').disabled).toBe(true);
});
it('discovers managed teams safely and releases only the chosen controlled game', async () => {
    await mocks.checkAuth.mock.calls[0][0]({ uid: 'u', email: 'u@example.com' });
    expect(mocks.getUserTeamsWithAccess).toHaveBeenCalledWith('u', 'u@example.com');
    expect(document.querySelector('#team').textContent).toBe('<Falcons>');
    expect(document.querySelectorAll('#game option')).toHaveLength(1);
    document.querySelector('#release').click(); await settle();
    expect(mocks.configure).toHaveBeenCalledWith({ action: 'release', teamId: 't', gameId: 'g' });
});
it('uncertain pairing retries use the same capability and download only after success', async () => {
    await mocks.checkAuth.mock.calls[0][0]({ uid: 'u', email: 'u@example.com' });
    mocks.configure.mockRejectedValueOnce(new Error('Temporary failure'));
    document.querySelector('#pair').click(); await settle();
    const first = mocks.configure.mock.calls[0][0];
    expect(first.token).toMatch(/^[a-f0-9]{64}$/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    document.querySelector('#pair').click(); await settle();
    expect(mocks.configure.mock.calls[1][0]).toEqual(first);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
});
