// @vitest-environment jsdom
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../apps/app/src/components/AppSearchDialog.tsx', async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
        AppSearchDialog: ({ open, onClose }) => open
            ? React.createElement('div', { role: 'dialog', 'aria-label': 'Loaded search dialog' },
                React.createElement('button', { type: 'button', onClick: onClose }, 'Close search'),
                React.createElement('div', null, 'Loaded search dialog'))
            : null
    };
});

import { AppShell } from '../../apps/app/src/components/AppShell.tsx';

const shellSource = readFileSync(resolve(process.cwd(), 'apps/app/src/components/AppShell.tsx'), 'utf8');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent'
    },
    profile: {},
    loading: false,
    error: null,
    roles: ['parent'],
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: async () => {},
    signOut: async () => {}
};

async function flush(ms = 0) {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
}

async function renderShell() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    window.matchMedia = vi.fn(() => ({
        matches: false,
        media: '(min-width: 1024px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    }));

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: ['/home'] },
            React.createElement(
                Routes,
                null,
                React.createElement(Route, {
                    path: '*',
                    element: React.createElement(AppShell, { auth }, React.createElement('div', null, 'Child route'))
                })
            )
        ));
    });

    await flush();
    return { container, root };
}

function findButton(container, label) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(label) || candidate.getAttribute('aria-label') === label);
    if (!button) throw new Error(`Button not found: ${label}`);
    return button;
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('AppShell lazy search loading', () => {
    it('declares AppSearchDialog behind a lazy import boundary', () => {
        expect(shellSource).toContain("const AppSearchDialog = lazy(() => import('./AppSearchDialog').then((module) => ({ default: module.AppSearchDialog })));");
        expect(shellSource).not.toContain("import { AppSearchDialog } from './AppSearchDialog';");
        expect(shellSource).toContain('Suspense fallback={<AppSearchDialogLoading onClose={() => setSearchOpen(false)} />}');
    });

    it('shows a loading dialog before the search module resolves', async () => {
        const { container } = await renderShell();

        await act(async () => {
            findButton(container, 'Search').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });

        expect(container.textContent).toContain('Loading search');
        expect(container.textContent).toContain('Preparing teams, players, actions, and help results.');

        await flush(40);
        expect(container.textContent).toContain('Loaded search dialog');
    });
});
