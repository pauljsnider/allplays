// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

const helpMocks = vi.hoisted(() => ({
    getHelpKnowledgeDocs: vi.fn(),
    searchHelpKnowledge: vi.fn()
}));

vi.mock('../../apps/app/src/lib/helpKnowledgeService.ts', () => helpMocks);

import { HelpArticle } from '../../apps/app/src/pages/HelpArticle.tsx';
import { HelpPortal } from '../../apps/app/src/pages/HelpPortal.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const docs = [
    {
        id: 'all-guide',
        title: 'ALL PLAYS basics',
        file: 'help.html',
        url: 'https://allplays.ai/help.html',
        roles: ['all'],
        summary: 'General help for everyone.',
        text: 'ALL PLAYS basics General help for everyone. Start here for account setup and common app tasks.'
    },
    {
        id: 'coach-schedule',
        title: 'Coach schedule tools',
        file: 'help-team-operations.html',
        url: 'https://allplays.ai/help-team-operations.html',
        roles: ['coach'],
        summary: 'Manage practices and game day timing.',
        text: 'Coach schedule tools Manage practices and game day timing. Schedule practices, games, and reminders.'
    },
    {
        id: 'parent-fees',
        title: 'Parent fee guide',
        file: 'help-account.html',
        url: 'https://allplays.ai/help-account.html',
        roles: ['parent'],
        summary: 'Pay and track team fees.',
        text: 'Parent fee guide Pay and track team fees. Review balances and payment links.'
    }
];

function SameRouteLauncher({ nextState }) {
    const navigate = useNavigate();

    return React.createElement('button', {
        type: 'button',
        onClick: () => navigate('/help', { state: nextState })
    }, 'Load same route state');
}

async function renderHelp(initialEntry = '/help', extraHelpContent = null) {
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
                React.createElement(Route, {
                    path: '/help',
                    element: React.createElement(React.Fragment, null, extraHelpContent, React.createElement(HelpPortal))
                }),
                React.createElement(Route, { path: '/help/:helpId', element: React.createElement(HelpArticle) })
            )
        ));
    });

    return { container, root };
}

async function setInputValue(input, value) {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        setter.call(input, value);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    });
}

async function clickElement(element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
});

describe('HelpPortal', () => {
    it('renders a dedicated help landing page with search, role filters, and packaged article cards', async () => {
        helpMocks.getHelpKnowledgeDocs.mockReturnValue(docs);
        helpMocks.searchHelpKnowledge.mockReturnValue([docs[1]]);

        const { container, root } = await renderHelp();

        expect(container.querySelector('input[aria-label="Search help articles"]')).toBeTruthy();
        expect(container.textContent).toContain('Role filter');
        expect(container.textContent).toContain('ALL PLAYS basics');
        expect(container.textContent).toContain('Coach schedule tools');
        expect(container.textContent).toContain('Parent fee guide');

        await act(async () => root.unmount());
    });

    it('updates the rendered help list inline when the role filter and query change', async () => {
        helpMocks.getHelpKnowledgeDocs.mockReturnValue(docs);
        helpMocks.searchHelpKnowledge.mockImplementation(({ query, roleFilter }) => {
            if (query === 'schedule' && roleFilter === 'coach') return [docs[1]];
            return [];
        });

        const { container, root } = await renderHelp();

        expect(container.textContent).toContain('Parent fee guide');
        await clickElement(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Coach'));
        expect(container.textContent).toContain('Coach schedule tools');
        expect(container.textContent).toContain('ALL PLAYS basics');
        expect(container.textContent).not.toContain('Parent fee guide');

        const input = container.querySelector('input[aria-label="Search help articles"]');
        await setInputValue(input, 'schedule');

        expect(helpMocks.searchHelpKnowledge).toHaveBeenCalledWith({
            query: 'schedule',
            roleFilter: 'coach',
            limit: docs.length
        });
        expect(container.textContent).toContain('Coach schedule tools');
        expect(container.textContent).not.toContain('Parent fee guide');
        expect(container.querySelector('a[href="/help/coach-schedule"]')).toBeTruthy();

        await act(async () => root.unmount());
    });

    it('opens help results in-app and preserves the portal return path', async () => {
        helpMocks.getHelpKnowledgeDocs.mockReturnValue(docs);
        helpMocks.searchHelpKnowledge.mockImplementation(({ query }) => query === 'schedule' ? [docs[1]] : []);

        const { container, root } = await renderHelp();

        await clickElement(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Coach'));
        await setInputValue(container.querySelector('input[aria-label="Search help articles"]'), 'schedule');
        await clickElement(container.querySelector('a[href="/help/coach-schedule"]'));

        expect(container.textContent).toContain('Coach schedule tools');
        expect(container.textContent).toContain('Manage practices and game day timing.');
        expect(container.textContent).toContain('Back to Help Portal');

        await clickElement(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Back to Help Portal'));
        expect(container.querySelector('input[aria-label="Search help articles"]')?.value).toBe('schedule');
        expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Coach')?.getAttribute('aria-pressed')).toBe('true');

        await act(async () => root.unmount());
    });

    it('resyncs search state when the help portal receives a same-route navigation handoff', async () => {
        helpMocks.getHelpKnowledgeDocs.mockReturnValue(docs);
        helpMocks.searchHelpKnowledge.mockImplementation(({ query, roleFilter }) => {
            if (query === 'fees' && roleFilter === 'parent') return [docs[2]];
            if (query === 'schedule' && roleFilter === 'coach') return [docs[1]];
            return [];
        });

        const initialEntry = {
            pathname: '/help',
            state: { helpQuery: 'fees', helpRoleFilter: 'parent' }
        };
        const nextState = { helpQuery: 'schedule', helpRoleFilter: 'coach' };
        const launcher = React.createElement(SameRouteLauncher, { nextState });
        const { container, root } = await renderHelp(initialEntry, launcher);

        expect(container.querySelector('input[aria-label="Search help articles"]')?.value).toBe('fees');
        expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Parent')?.getAttribute('aria-pressed')).toBe('true');

        await clickElement(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Load same route state'));

        expect(container.querySelector('input[aria-label="Search help articles"]')?.value).toBe('schedule');
        expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Coach')?.getAttribute('aria-pressed')).toBe('true');
        expect(container.textContent).toContain('Coach schedule tools');
        expect(container.textContent).not.toContain('Parent fee guide');

        await act(async () => root.unmount());
    });
});
