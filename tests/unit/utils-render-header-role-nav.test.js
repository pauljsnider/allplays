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

describe('renderHeader authenticated navigation dashboard reachability', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.navigator;
    });

    it('keeps My Teams reachable before full-access dashboard lookup hydrates coach links', () => {
        const { container } = renderHeaderFor({ uid: 'coach-1', email: 'coach@example.com', coachOf: [], parentOf: [] });

        expect(isHidden(container, '#nav-my-teams-desktop')).toBe(false);
        expect(isHidden(container, '#nav-my-teams-mobile')).toBe(false);
        expect(container.querySelector('#nav-my-teams-desktop').getAttribute('href')).toBe('dashboard.html');
        expect(container.querySelector('#nav-my-teams-mobile').getAttribute('href')).toBe('dashboard.html');
    });

    it('keeps My Players reachable so parents can redeem codes or request access', () => {
        const { container } = renderHeaderFor({ uid: 'parent-1', email: 'parent@example.com', parentOf: [], coachOf: [] });

        expect(isHidden(container, '#nav-my-players-desktop')).toBe(false);
        expect(isHidden(container, '#nav-my-players-mobile')).toBe(false);
        expect(container.querySelector('#nav-my-players-desktop').getAttribute('href')).toBe('parent-dashboard.html');
        expect(container.querySelector('#nav-my-players-mobile').getAttribute('href')).toBe('parent-dashboard.html');
    });

    it('hides dashboard links for signed-out users', () => {
        const { container } = renderHeaderFor(null);

        expect(isHidden(container, '#nav-my-players-desktop')).toBe(true);
        expect(isHidden(container, '#nav-my-players-mobile')).toBe(true);
        expect(isHidden(container, '#nav-my-teams-desktop')).toBe(true);
        expect(isHidden(container, '#nav-my-teams-mobile')).toBe(true);
    });
});
