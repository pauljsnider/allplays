// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../apps/app/src/lib/publicActions.ts', () => ({
    openPublicUrl: vi.fn()
}));

import { openPublicUrl } from '../../apps/app/src/lib/publicActions.ts';
import { CapabilityPage } from '../../apps/app/src/pages/CapabilityPage.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function renderCapabilityPage(initialEntry) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: [initialEntry] },
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: '/capabilities/:capabilityId', element: React.createElement(CapabilityPage) }),
                React.createElement(Route, { path: '/home', element: React.createElement('div', null, 'Home redirect') })
            )
        ));
    });

    return { container, root };
}

function linkByText(container, text) {
    const link = Array.from(container.querySelectorAll('a')).find((candidate) => candidate.textContent.includes(text));
    if (!link) {
        const labels = Array.from(container.querySelectorAll('a')).map((candidate) => candidate.textContent.trim() || candidate.getAttribute('href') || '(unlabeled)');
        throw new Error(`Link not found: ${text}. Available links: ${labels.join(', ')}`);
    }
    return link;
}

function buttonByText(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(text));
    if (!button) {
        const labels = Array.from(container.querySelectorAll('button')).map((candidate) => candidate.textContent.trim() || '(unlabeled)');
        throw new Error(`Button not found: ${text}. Available buttons: ${labels.join(', ')}`);
    }
    return button;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
});

describe('CapabilityPage launch CTAs', () => {
    it('keeps the game-planning capability on the in-app route CTA', async () => {
        const { container, root } = await renderCapabilityPage('/capabilities/game-plan');

        expect(container.textContent).toContain('Current site page');
        expect(container.textContent).toContain('game-plan.html');
        expect(container.querySelector('a[href="/game-plan.html"]')).toBeNull();
        expect(linkByText(container, 'Open app route').getAttribute('href')).toBe('/schedule');
        expect(container.textContent).not.toContain('Open current page');
        expect(openPublicUrl).not.toHaveBeenCalled();

        await act(async () => root.unmount());
    });

    it('opens legacy-link capability pages through the native-safe public URL flow', async () => {
        const { container, root } = await renderCapabilityPage('/capabilities/admin');

        expect(container.textContent).toContain('Current site page');
        expect(container.textContent).toContain('admin.html');
        expect(container.querySelector('a[href="/admin.html"]')).toBeNull();

        await act(async () => {
            buttonByText(container, 'Open current page').click();
        });

        expect(openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/admin.html');

        await act(async () => root.unmount());
    });

    it('keeps native-shell capabilities on the internal app route CTA', async () => {
        const { container, root } = await renderCapabilityPage('/capabilities/profile');

        expect(linkByText(container, 'Open app route').getAttribute('href')).toBe('/profile');
        expect(container.textContent).not.toContain('Open current page');
        expect(openPublicUrl).not.toHaveBeenCalled();

        await act(async () => root.unmount());
    });

    it('routes the help capability to the in-app help portal', async () => {
        const { container, root } = await renderCapabilityPage('/capabilities/help');

        expect(linkByText(container, 'Open app route').getAttribute('href')).toBe('/help');
        expect(container.textContent).not.toContain('Open current page');
        expect(openPublicUrl).not.toHaveBeenCalled();

        await act(async () => root.unmount());
    });

    it('routes the standard tracker capability to the native schedule game hub', async () => {
        const { container, root } = await renderCapabilityPage('/capabilities/track-standard');

        expect(container.textContent).toContain('Current site page');
        expect(container.textContent).toContain('track.html');
        expect(linkByText(container, 'Open app route').getAttribute('href')).toBe('/schedule');
        expect(container.textContent).not.toContain('Open current page');
        expect(openPublicUrl).not.toHaveBeenCalled();

        await act(async () => root.unmount());
    });

    it('does not show a primary launch CTA for future capabilities', async () => {
        const { container, root } = await renderCapabilityPage('/capabilities/organization-schedule');

        expect(container.textContent).toContain('Current site page');
        expect(container.textContent).toContain('organization-schedule.html');
        expect(container.textContent).not.toContain('Open current page');
        expect(container.textContent).not.toContain('Open app route');
        expect(openPublicUrl).not.toHaveBeenCalled();

        await act(async () => root.unmount());
    });
});
