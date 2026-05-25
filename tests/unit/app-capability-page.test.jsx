// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

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

afterEach(() => {
    document.body.innerHTML = '';
});

describe('CapabilityPage launch CTAs', () => {
    it('shows a primary current page link for stub capabilities with a legacy path', async () => {
        const { container, root } = await renderCapabilityPage('/capabilities/game-plan');

        expect(container.textContent).toContain('Current site page');
        expect(container.textContent).toContain('game-plan.html');
        expect(linkByText(container, 'Open current page').getAttribute('href')).toBe('/game-plan.html');
        expect(container.textContent).not.toContain('Open app route');

        await act(async () => root.unmount());
    });

    it('keeps native-shell capabilities on the internal app route CTA', async () => {
        const { container, root } = await renderCapabilityPage('/capabilities/profile');

        expect(linkByText(container, 'Open app route').getAttribute('href')).toBe('/profile');
        expect(container.textContent).not.toContain('Open current page');

        await act(async () => root.unmount());
    });

    it('does not show a primary launch CTA for future capabilities', async () => {
        const { container, root } = await renderCapabilityPage('/capabilities/organization-schedule');

        expect(container.textContent).toContain('Current site page');
        expect(container.textContent).toContain('organization-schedule.html');
        expect(container.textContent).not.toContain('Open current page');
        expect(container.textContent).not.toContain('Open app route');

        await act(async () => root.unmount());
    });
});
