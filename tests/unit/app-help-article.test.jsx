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
vi.mock('lucide-react', () => ({
    ArrowLeft: () => null,
    Home: () => null,
    Search: () => null
}));

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

    it('renders structured account help with app routes instead of legacy filenames', async () => {
        helpMocks.getHelpKnowledgeDocs.mockReturnValue([{
            id: 'help-account',
            title: 'Account and Access',
            file: 'help-account.html',
            url: 'https://allplays.ai/help-account.html',
            roles: ['parent', 'coach', 'admin', 'member'],
            summary: 'Who does what for authentication, onboarding, and account state workflows.',
            text: [
                'Account and Access',
                'Who does what for authentication, onboarding, and account state workflows.',
                'Help - Account and Access',
                '← Back to Help Portal',
                'Login and Session',
                '- Member/Parent/Coach/Admin: Log in from #/auth.',
                '- Member/Parent/Coach/Admin: Log out from shared header controls.',
                'Forgot Password and Recovery',
                '- Member/Parent/Coach/Admin: Start reset from #/auth / #/reset-password.',
                'Profile and Identity',
                '- Member/Parent/Coach/Admin: Update profile data in #/profile.',
                '- Admin: Verify admin-only areas via admin tools and admin status checks.'
            ].join('\n')
        }]);

        const { container, root } = await renderHelpArticle('/help/help-account');
        const headings = Array.from(container.querySelectorAll('h2')).map((heading) => heading.textContent);
        const items = Array.from(container.querySelectorAll('li')).map((item) => item.textContent);

        expect(headings).toEqual([
            'Login and Session',
            'Forgot Password and Recovery',
            'Profile and Identity'
        ]);
        expect(items).toContain('Member/Parent/Coach/Admin: Log in from #/auth.');
        expect(items).toContain('Member/Parent/Coach/Admin: Start reset from #/auth / #/reset-password.');
        expect(items).toContain('Member/Parent/Coach/Admin: Update profile data in #/profile.');
        expect(items).toContain('Admin: Verify admin-only areas via admin tools and admin status checks.');
        expect(container.textContent).not.toMatch(/\b(?:login|reset-password|profile|admin)\.html\b/);

        await act(async () => root.unmount());
    });

    it('does not render flattened workflow search text before structured article content', async () => {
        helpMocks.getHelpKnowledgeDocs.mockReturnValue([{
            id: 'admin-ops',
            title: 'Operate Platform Admin Controls',
            file: 'workflow-admin-ops.html',
            url: 'https://allplays.ai/workflow-admin-ops.html',
            roles: ['admin'],
            summary: 'Use this workflow to run platform admin operations in ALL PLAYS.',
            text: [
                'Operate Platform Admin Controls',
                'Use this workflow to run platform admin operations in ALL PLAYS.',
                'Operate Platform Admin Controls - ALL PLAYS Help ← Back to Help Center Workflow Guide Operate Platform Admin Controls Use this workflow to run platform admin operations in ALL PLAYS. 4 min read Updated from live product pages On this page Who can use this Admin Overview Use this workflow to run platform admin operations in ALL PLAYS. In This Article Confirm admin entitlement before sensitive actions. Review teams, users, games, and recent activity in the admin dashboard. Find active and inactive teams.',
                '-',
                'Operate Platform Admin Controls - ALL PLAYS Help',
                '← Back to Help Center',
                'Workflow Guide',
                'Operate Platform Admin Controls',
                'Use this workflow to run platform admin operations in ALL PLAYS.',
                '4 min read',
                'Updated from live product pages',
                'On this page',
                'Who can use this',
                'Admin',
                'Overview',
                'Use this workflow to run platform admin operations in ALL PLAYS.',
                'In This Article',
                'Confirm admin entitlement before sensitive actions.',
                '- Review teams, users, games, and recent activity in the admin dashboard.',
                '- Find active and inactive teams.'
            ].join('\n')
        }]);

        const { container, root } = await renderHelpArticle('/help/admin-ops');
        const paragraphs = Array.from(container.querySelectorAll('p')).map((paragraph) => paragraph.textContent);
        const items = Array.from(container.querySelectorAll('li')).map((item) => item.textContent);

        expect(paragraphs.some((paragraph) => paragraph.includes('Review teams, users, games, and recent activity in the admin dashboard. Find active and inactive teams.'))).toBe(false);
        expect(container.textContent).not.toContain('Back to Help Center Workflow Guide Operate Platform Admin Controls');
        expect(items).toContain('Review teams, users, games, and recent activity in the admin dashboard.');
        expect(items).toContain('Find active and inactive teams.');

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
