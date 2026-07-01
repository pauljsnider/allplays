// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const helpMocks = vi.hoisted(() => ({
    getHelpKnowledgeDocs: vi.fn()
}));

vi.mock('../../apps/app/src/lib/helpKnowledgeService.ts', () => helpMocks);

import { HelpArticle } from '../../apps/app/src/pages/HelpArticle.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function renderHelpArticle(initialEntry) {
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
                React.createElement(Route, { path: '/help/:helpId', element: React.createElement(HelpArticle) }),
                React.createElement(Route, { path: '/home', element: React.createElement('div', null, 'Home route') })
            )
        ));
    });

    return { container, root };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
});

describe('HelpArticle', () => {
    it('renders a packaged help article from the app knowledge index', async () => {
        helpMocks.getHelpKnowledgeDocs.mockReturnValue([{
            id: 'account-password-reset',
            title: 'Reset a password',
            file: 'help-account.html',
            url: 'https://allplays.ai/help-account.html',
            roles: ['parent', 'coach'],
            summary: 'Recover account access.',
            text: 'Reset a password Recover account access. Help - Account and Access ← Back to Help Portal Use password reset when a parent cannot sign in. Complete the email reset link flow.'
        }]);

        const { container, root } = await renderHelpArticle('/help/account-password-reset');

        expect(container.textContent).toContain('Reset a password');
        expect(container.textContent).toContain('Recover account access.');
        expect(container.textContent).toContain('parent');
        expect(container.textContent).toContain('coach');
        expect(container.textContent).toContain('Use password reset when a parent cannot sign in.');
        expect(container.querySelector('a[href="https://allplays.ai/help-account.html"]')).toBeNull();

        await act(async () => root.unmount());
    });

    it('is registered as protected help portal routes', () => {
        const appSource = readFileSync('apps/app/src/App.tsx', 'utf8');

        expect(appSource).toContain("const HelpPortal = lazy(() => import('./pages/HelpPortal').then((module) => ({ default: module.HelpPortal })));"
        );
        expect(appSource).toContain("const HelpArticle = lazy(() => import('./pages/HelpArticle').then((module) => ({ default: module.HelpArticle })));"
        );
        // HelpPortal takes auth as a prop (like every other page) instead of calling
        // useAuth() itself, so navigating here doesn't mount a second, redundant
        // auth listener alongside the one App.tsx already set up.
        expect(appSource).toContain('<Route path="/help" element={<Protected auth={auth}><HelpPortal auth={auth} /></Protected>} />');
        expect(appSource).toContain('<Route path="/help/:helpId" element={<Protected auth={auth}><HelpArticle /></Protected>} />');
    });

    it('shows a friendly not-found state for unknown help ids', async () => {
        helpMocks.getHelpKnowledgeDocs.mockReturnValue([]);

        const { container, root } = await renderHelpArticle('/help/missing-article');

        expect(container.textContent).toContain('Help article not found');
        expect(container.textContent).toContain('This help article is not packaged in the app yet.');
        expect(container.textContent).toContain('Back to search');
        expect(container.querySelector('a[href="/home"]')).toBeTruthy();

        await act(async () => root.unmount());
    });
});
