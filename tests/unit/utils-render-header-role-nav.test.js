import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHeader } from '../../js/utils.js';

function renderHeaderFor(user) {
    const dom = new JSDOM('<!doctype html><div id="header-container"></div>', {
        url: 'https://allplays.test/index.html'
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: dom.window.navigator
    });

    const container = dom.window.document.getElementById('header-container');
    renderHeader(container, user);
    return { dom, container };
}

function isHidden(container, selector) {
    return container.querySelector(selector).classList.contains('hidden');
}

describe('renderHeader role-aware authenticated navigation', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.navigator;
    });

    it('shows only My Teams for coach-only users', () => {
        const { container } = renderHeaderFor({ uid: 'coach-1', coachOf: ['team-1'], parentOf: [] });

        expect(isHidden(container, '#nav-my-players-desktop')).toBe(true);
        expect(isHidden(container, '#nav-my-players-mobile')).toBe(true);
        expect(isHidden(container, '#nav-my-teams-desktop')).toBe(false);
        expect(isHidden(container, '#nav-my-teams-mobile')).toBe(false);
    });

    it('shows only My Players for parent-only users', () => {
        const { container } = renderHeaderFor({
            uid: 'parent-1',
            parentOf: [{ teamId: 'team-1', playerId: 'player-1' }],
            coachOf: []
        });

        expect(isHidden(container, '#nav-my-players-desktop')).toBe(false);
        expect(isHidden(container, '#nav-my-players-mobile')).toBe(false);
        expect(isHidden(container, '#nav-my-teams-desktop')).toBe(true);
        expect(isHidden(container, '#nav-my-teams-mobile')).toBe(true);
    });

    it('shows both role links for mixed-role users', () => {
        const { container } = renderHeaderFor({
            uid: 'mixed-1',
            parentOf: [{ teamId: 'team-1', playerId: 'player-1' }],
            coachOf: ['team-2']
        });

        expect(isHidden(container, '#nav-my-players-desktop')).toBe(false);
        expect(isHidden(container, '#nav-my-players-mobile')).toBe(false);
        expect(isHidden(container, '#nav-my-teams-desktop')).toBe(false);
        expect(isHidden(container, '#nav-my-teams-mobile')).toBe(false);
    });
});
