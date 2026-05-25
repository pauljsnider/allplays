// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

const serviceMocks = vi.hoisted(() => ({
    loadParentRegistrationDetail: vi.fn()
}));

const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn()
}));

vi.mock('../../apps/app/src/lib/parentToolsService.ts', () => serviceMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);

import { RegistrationDetail } from '../../apps/app/src/pages/RegistrationDetail.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = { user: { uid: 'user-1', parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] } };

function registrationModel(overrides = {}) {
    return {
        teamName: 'Bears',
        isPublished: true,
        onlineCheckout: true,
        legacyUrl: 'https://allplays.ai/registration.html?teamId=team-1&formId=form-1',
        form: {
            programName: 'Summer Camp',
            description: 'Skills week',
            season: 'Summer',
            currency: 'USD',
            waiverText: 'I agree to the terms.',
            participantFields: [{ id: 'name', label: 'Participant name', type: 'text', required: true }],
            guardianFields: [{ id: 'email', label: 'Guardian email', type: 'email' }],
            registrationOptionCounts: { option_1: { enrolled: 5 } }
        },
        options: [{ id: 'option_1', countKey: 'option_1', title: 'Full Day', description: '8 AM - 5 PM', capacityLimit: 10, waitlistEnabled: true }],
        feeSnapshot: { finalAmountDueCents: 12000 },
        paymentNotice: 'Online checkout is available.',
        paymentPlans: [{ id: 'pay_full', title: 'Pay in full' }, { id: 'installments', title: 'Installment plan' }],
        ...overrides
    };
}

async function renderDetail() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: ['/parent-tools/registrations/team-1/form-1'] },
            React.createElement(Routes, null,
                React.createElement(Route, { path: '/parent-tools/registrations/:teamId/:formId', element: React.createElement(RegistrationDetail, { auth }) })
            )
        ));
    });
    return { container, root };
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function waitForText(container, text) {
    for (let index = 0; index < 30; index += 1) {
        if (container.textContent.includes(text)) return;
        await flush();
    }
    throw new Error(`Timed out waiting for text: ${text}`);
}

async function clickButton(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.trim().includes(text));
    if (!button) throw new Error(`Button not found: ${text}`);
    await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
}

beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
});

describe('React app registration detail', () => {
    it('renders the in-app registration review shell with accessible fields and fallback link', async () => {
        serviceMocks.loadParentRegistrationDetail.mockResolvedValue(registrationModel());
        const { container } = await renderDetail();
        await waitForText(container, 'Participant information');

        expect(serviceMocks.loadParentRegistrationDetail).toHaveBeenCalledWith(auth.user, 'team-1', 'form-1');
        expect(container.textContent).toContain('Guardian information');
        expect(container.textContent).toContain('Waiver');
        expect(container.textContent).toContain('Registration options');
        expect(container.textContent).toContain('5 spots left');
        expect(container.textContent).toContain('$120.00');
        expect(container.textContent).toContain('Installment plan');
        expect(container.querySelector('label[for="participant-name"]')).toBeTruthy();
        expect(container.querySelector('#participant-name')).toBeTruthy();
        expect(container.querySelector('legend')?.textContent).toContain('Registration options');

        await clickButton(container, 'Legacy form');
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/registration.html?teamId=team-1&formId=form-1');
    });

    it('shows retry and unpublished states without creating a registration', async () => {
        serviceMocks.loadParentRegistrationDetail.mockRejectedValueOnce(new Error('Unable to load this registration.'));
        const { container } = await renderDetail();
        await waitForText(container, 'Unable to load this registration.');

        serviceMocks.loadParentRegistrationDetail.mockResolvedValue(registrationModel({ isPublished: false }));
        await clickButton(container, 'Retry');
        await waitForText(container, 'Registration unavailable');
        expect(container.textContent).toContain('This linked registration form is not published right now.');
    });
});
