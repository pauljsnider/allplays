// @vitest-environment jsdom
import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const serviceMocks = vi.hoisted(() => ({
    acceptTeamRegistrationOfferForApp: vi.fn(),
    approveTeamRegistrationForApp: vi.fn(),
    cancelRegistrationCheckout: vi.fn(),
    extendTeamRegistrationOfferForApp: vi.fn(),
    initiateRegistrationCheckout: vi.fn(),
    loadParentRegistrationDetail: vi.fn(),
    loadParentRegistrations: vi.fn(),
    loadPublicRegistrationDetail: vi.fn(),
    loadStaffRegistrationDetail: vi.fn(),
    loadTeamRegistrationQueuePage: vi.fn(),
    loadTeamRegistrationRosterPlayers: vi.fn(),
    rejectTeamRegistrationForApp: vi.fn(),
    submitOfflineRegistration: vi.fn(),
}));

const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn()
}));

// Mock registration-flow.js
const registrationFlowMocks = vi.hoisted(() => ({
  buildPendingRegistrationRecord: vi.fn((params = {}) => ({
    id: 'pending-registration-1',
    status: params.status || 'pending',
    participant: params.participant || {},
    guardian: params.guardian || {},
  })),
  getActiveRegistrationOptions: vi.fn((form = {}) => form.registrationOptions || form.options || []),
  getPaymentPlanChoices: vi.fn(() => [{ id: 'pay_full', type: 'pay_full', title: 'Pay in full' }]),
  getRegistrationPaymentNotice: vi.fn(() => ''),
  hasOnlineRegistrationCheckout: vi.fn(() => true),
  hasQuantityDiscountRule: vi.fn(() => false),
  normalizeRegistrationForm: vi.fn((form = {}) => form),
  requiresRegistrationOption: vi.fn(() => true),
  decideRegistrationPlacement: vi.fn((params) => ({
    status: 'pending',
    message: 'Placement pending',
    selectedOption: params.selectedOptionId ? { id: params.selectedOptionId, countKey: params.selectedOptionId } : null,
    nextCounts: { enrolled: 1, waitlisted: 0 },
  })),
  calculateRegistrationFeeSnapshot: vi.fn((form = {}, options = {}) => {
    const quantity = Math.max(1, Number(options.quantity || 1));
    const originalFeeAmountCents = Number(form.feeAmountCents || 10000); // Access feeAmountCents directly from form
    const subtotalAmountCents = originalFeeAmountCents * quantity;
    const appliedDiscounts = quantity >= 2 ? [{ id: 'sibling', label: 'Sibling discount', amountCents: 2500 }] : [];
    const finalAmountDueCents = subtotalAmountCents - appliedDiscounts.reduce((sum, discount) => sum + discount.amountCents, 0);
    return { originalFeeAmountCents, subtotalAmountCents, appliedDiscounts, finalAmountDueCents, currency: form.currency || 'USD' };
  }),
  formatFeeSnapshotLines: vi.fn((snapshot = {}) => ([
    { label: 'Original fee', amountCents: snapshot.subtotalAmountCents ?? snapshot.originalFeeAmountCents ?? 0 },
    ...(snapshot.appliedDiscounts || []).map((discount) => ({ label: discount.label, amountCents: -Math.abs(Number(discount.amountCents || 0)) })),
    { label: 'Final amount due', amountCents: snapshot.finalAmountDueCents ?? 0, strong: true },
  ])),
}));

vi.mock('../../apps/app/src/lib/parentRegistrationsService.ts', () => serviceMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);
vi.mock('../../js/registration-flow.js', () => registrationFlowMocks);

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
        const selectedOptionSummary = container.querySelector('[aria-label="Selected registration option"]');
        expect(selectedOptionSummary).toBeTruthy();
        expect(selectedOptionSummary?.textContent).toContain('Registration option');
        expect(selectedOptionSummary?.textContent).toContain('5 spots left');
        expect(container.textContent).toContain('$120.00');
        expect(container.textContent).toContain('Installment plan');
        expect(container.querySelector('label[for="participant-name"]')).toBeTruthy();
        expect(container.querySelector('#participant-name')).toBeTruthy();
        expect(container.querySelector('legend')).toBeNull();

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
