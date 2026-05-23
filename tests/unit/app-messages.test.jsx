// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

import { Messages } from '../../apps/app/src/pages/Messages.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent'
    },
    isCoach: false,
    isAdmin: false
};

async function renderMessages(initialEntry = '/messages/team-bears') {
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
                    path: '/messages/:teamId?',
                    element: React.createElement(Messages, { auth })
                })
            )
        ));
    });

    return { container, root };
}

function buttonsNamed(container, name) {
    return Array.from(container.querySelectorAll('button')).filter((button) => button.textContent.trim() === name);
}

function buttonByLabel(container, label) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.getAttribute('aria-label') === label);
    if (!button) throw new Error(`Button not found: ${label}`);
    return button;
}

beforeEach(() => {
    window.matchMedia = () => ({
        matches: false,
        media: '(min-width: 1024px)',
        addEventListener: () => {},
        removeEventListener: () => {}
    });
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('React app Messages chat window', () => {
    it('does not render the persistent advanced toolbar while keeping one attachment and send control in the composer', async () => {
        const { container } = await renderMessages();

        expect(buttonsNamed(container, 'AI')).toHaveLength(0);
        expect(buttonsNamed(container, 'React')).toHaveLength(0);
        expect(buttonsNamed(container, 'Edit')).toHaveLength(0);
        expect(buttonsNamed(container, 'Delete')).toHaveLength(0);
        expect(buttonByLabel(container, 'Add attachment')).toBeTruthy();
        expect(buttonByLabel(container, 'Send message')).toBeTruthy();
        expect(container.querySelectorAll('button[aria-label="Add attachment"]')).toHaveLength(1);
        expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('Message Bears');
    });

    it('shows advanced controls only after opening a message action trigger', async () => {
        const { container } = await renderMessages();

        expect(buttonsNamed(container, 'AI')).toHaveLength(0);
        expect(buttonsNamed(container, 'React')).toHaveLength(0);
        expect(buttonsNamed(container, 'Edit')).toHaveLength(0);
        expect(buttonsNamed(container, 'Delete')).toHaveLength(0);

        await act(async () => {
            buttonByLabel(container, 'Message actions for Coach Jamie').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(buttonsNamed(container, 'AI')).toHaveLength(1);
        expect(buttonsNamed(container, 'React')).toHaveLength(1);
        expect(buttonsNamed(container, 'Edit')).toHaveLength(1);
        expect(buttonsNamed(container, 'Delete')).toHaveLength(1);
        expect(container.querySelector('[aria-label="Advanced actions for Coach Jamie"]')).toBeTruthy();
    });
});
