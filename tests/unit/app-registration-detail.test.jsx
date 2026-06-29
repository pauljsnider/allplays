// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mock parentRegistrationsService
const parentRegistrationsServiceMocks = vi.hoisted(() => ({
  loadParentRegistrations: vi.fn(),
  loadStaffRegistrationDetail: vi.fn(),
  loadTeamRegistrationQueue: vi.fn(),
  loadTeamRegistrationQueuePage: vi.fn(),
  loadTeamRegistrationRosterPlayers: vi.fn(),
  loadPublicRegistrationDetail: vi.fn(),
  submitOfflineRegistration: vi.fn(),
  initiateRegistrationCheckout: vi.fn(),
  acceptTeamRegistrationOfferForApp: vi.fn(),
  approveTeamRegistrationForApp: vi.fn(),
  extendTeamRegistrationOfferForApp: vi.fn(),
  rejectTeamRegistrationForApp: vi.fn(),
  cancelRegistrationCheckout: vi.fn(),
}));

const publicActionsMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn(),
}));

// Mock registration-flow.js
const registrationFlowMocks = vi.hoisted(() => ({
  buildPendingRegistrationRecord: vi.fn((params) => ({
    ...params,
    id: 'mock-pending-reg-id',
    status: params.status || 'pending',
  })),
  buildRegistrationRecord: vi.fn((params) => ({
    ...params,
    id: 'mock-reg-id',
    status: params.status || 'pending',
  })),
  decideRegistrationPlacement: vi.fn((params) => ({
    status: 'pending',
    message: 'Placement pending',
    selectedOption: params.selectedOptionId ? { id: params.selectedOptionId, countKey: params.selectedOptionId } : null,
    nextCounts: { enrolled: 1, waitlisted: 0 },
  })),
  calculateRegistrationFeeSnapshot: vi.fn((form = {}, options = {}) => {
    const quantity = Math.max(1, Number(options.quantity || 1));
    const originalFeeAmountCents = Number(form.feeAmountCents || 10000);
    const subtotalAmountCents = originalFeeAmountCents * quantity;
    // Only apply sibling discount if a quantity discount rule is active in the form
    const hasQuantityDiscountRuleActive = (form.discountRules || []).some(rule => rule.type === 'quantity' && rule.active !== false);
    const appliedDiscounts = (quantity >= 2 && hasQuantityDiscountRuleActive) ? [{ id: 'sibling', label: 'Sibling discount', amountCents: 2500 }] : [];
    const finalAmountDueCents = subtotalAmountCents - appliedDiscounts.reduce((sum, discount) => sum + discount.amountCents, 0);
    return { originalFeeAmountCents, subtotalAmountCents, appliedDiscounts, finalAmountDueCents, currency: form.currency || 'USD' };
  }),
  formatFeeSnapshotLines: vi.fn((snapshot = {}) => ([
    { label: 'Original fee', amountCents: snapshot.subtotalAmountCents ?? snapshot.originalFeeAmountCents ?? 0 },
    ...(snapshot.appliedDiscounts || []).map((discount) => ({ label: discount.label, amountCents: -Math.abs(Number(discount.amountCents || 0)) })),
    { label: 'Final amount due', amountCents: snapshot.finalAmountDueCents ?? 0, strong: true },
  ])),
  getPaymentPlanChoices: vi.fn(() => ([{ id: 'pay_full', title: 'Pay in full' }])),
  getActiveRegistrationOptions: vi.fn(() => ([{ id: 'opt-1', title: 'Option 1', capacityLimit: 10 }])),
  requiresRegistrationOption: vi.fn(() => true),
  hasQuantityDiscountRule: vi.fn(() => false), // Default mock for new helper
}));

vi.mock('../../apps/app/src/lib/parentRegistrationsService.ts', () => parentRegistrationsServiceMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionsMocks);
vi.mock('@legacy/registration-flow.js', () => registrationFlowMocks);

import { RegistrationDetail, TeamRegistrationReview, selectInitialRegistrationOption } from '../../apps/app/src/pages/RegistrationDetail.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
  user: {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
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
  signOut: async () => {},
};

async function renderRegistrationDetail(teamId = 'team-1', formId = 'form-1') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(
      MemoryRouter,
      { initialEntries: [`/parent-tools/registrations/${teamId}/${formId}`] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/parent-tools/registrations/:teamId/:formId',
          element: React.createElement(RegistrationDetail, { auth }),
        }),
        React.createElement(Route, {
          path: '/parent-tools/registrations', // Fallback for back button
          element: React.createElement('div', null, 'Registrations List'),
        })
      )
    ));
  });

  await flush();
  return { container, root };
}

async function renderPublicRegistrationDetail(teamId = 'team-public', formId = 'form-public', search = '') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(
      MemoryRouter,
      { initialEntries: [`/registration?teamId=${teamId}&formId=${formId}${search ? `&${search}` : ''}`] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/registration',
          element: React.createElement(RegistrationDetail, { auth: { ...auth, user: null }, publicAccess: true }),
        })
      )
    ));
  });

  await flush();
  return { container, root };
}

async function renderStaffRegistrationReview(teamId = 'team-coach', formId = 'form-review') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(
      MemoryRouter,
      { initialEntries: [`/teams/${teamId}/registrations/${formId}`] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/teams/:teamId/registrations/:formId',
          element: React.createElement(TeamRegistrationReview, { auth: { ...auth, roles: ['coach'], user: { ...auth.user, roles: ['coach'], coachOf: [teamId] } } }),
        }),
        React.createElement(Route, {
          path: '/teams/:teamId',
          element: React.createElement('div', null, 'Team Detail'),
        })
      )
    ));
  });

  await flush();
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

async function changeInputValue(container, labelText, value) {
  const input = Array.from(container.querySelectorAll('input, select, textarea')).find(
    (el) => el.labels && Array.from(el.labels).some(label => label.textContent.includes(labelText))
  );
  if (!input) throw new Error(`Input with label "${labelText}" not found.`);
  await act(async () => {
    if (input.type === 'checkbox') {
      const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
      checkedSetter?.call(input, value);
    } else {
      const prototype = input instanceof window.HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : input instanceof window.HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      valueSetter?.call(input, value);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

async function clickButton(container, text) {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent.includes(text)
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  await act(async () => {
    button.click();
  });
  await flush();
}

async function ensureRegistrationOptionResolved(container, optionLabel = 'Option 1') {
  const selector = Array.from(container.querySelectorAll('select')).find(
    (el) => el.labels && Array.from(el.labels).some((label) => label.textContent.includes('Registration option'))
  );
  if (selector) {
    await changeInputValue(container, 'Registration option', 'opt-1');
    return;
  }

  const summary = container.querySelector('[aria-label="Selected registration option"]');
  if (!summary) throw new Error('Registration option selector or summary not found.');
  expect(summary.textContent).toContain('Registration option');
  expect(summary.textContent).toContain(optionLabel);
}

beforeEach(() => {
  vi.clearAllMocks();
  registrationFlowMocks.decideRegistrationPlacement.mockImplementation((params) => ({
    status: 'pending',
    message: 'Placement pending',
    selectedOption: params.selectedOptionId ? { id: params.selectedOptionId, countKey: params.selectedOptionId } : null,
    nextCounts: { enrolled: 1, waitlisted: 0 },
  }));
  registrationFlowMocks.getPaymentPlanChoices.mockReturnValue([{ id: 'pay_full', title: 'Pay in full' }]);
  registrationFlowMocks.getActiveRegistrationOptions.mockReturnValue([{ id: 'opt-1', title: 'Option 1', capacityLimit: 10 }]);
  registrationFlowMocks.requiresRegistrationOption.mockReturnValue(true);
  registrationFlowMocks.hasQuantityDiscountRule.mockReturnValue(false);
  parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValue([
    {
      id: 'form-1',
      teamId: 'team-1',
      teamName: 'Bears',
      programName: 'Summer Camp',
      description: 'Skills week',
      season: 'Summer',
      feeLabel: '$75.00',
      paymentNotice: 'Offline payment accepted.',
      onlineCheckout: false,
      options: [{ id: 'opt-1', title: 'Option 1' }],
      registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
      participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
      guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
      waiverText: 'I agree to the terms and conditions.',
      url: '/registration.html?teamId=team-1&formId=form-1',
      discountRules: [], // Default to no quantity discounts for most tests
    },
  ]);
  parentRegistrationsServiceMocks.loadPublicRegistrationDetail.mockResolvedValue({
    teamName: 'Public Bears',
    isPublished: true,
    onlineCheckout: false,
    legacyUrl: '/registration.html?teamId=team-public&formId=form-public',
    form: {
      id: 'form-public',
      teamId: 'team-public',
      programName: 'Open Clinic',
      description: 'Shared public registration',
      season: 'Fall',
      currency: 'USD',
      participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
      guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
      registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
    },
    options: [{ id: 'opt-1', title: 'Option 1' }],
    feeSnapshot: { finalAmountDueCents: 10000, currency: 'USD' },
    paymentNotice: '',
    paymentPlans: [{ id: 'pay_full', title: 'Pay in full' }],
  });
  parentRegistrationsServiceMocks.loadStaffRegistrationDetail.mockResolvedValue({
    teamName: 'Coach Bears',
    isPublished: true,
    onlineCheckout: false,
    legacyUrl: '/registration-review.html?teamId=team-coach&formId=form-review',
    form: {
      id: 'form-review',
      teamId: 'team-coach',
      programName: 'Travel Tryouts',
      description: 'Review queue',
      season: 'Spring',
      currency: 'USD',
      participantFields: [],
      guardianFields: [],
      registrationOptionCounts: {},
    },
    options: [{ id: 'opt-1', title: 'Travel' }],
    feeSnapshot: { finalAmountDueCents: 15000, currency: 'USD' },
    paymentNotice: '',
    paymentPlans: [{ id: 'pay_full', title: 'Pay in full' }],
  });
  parentRegistrationsServiceMocks.loadTeamRegistrationQueue.mockResolvedValue({
    reviews: [{
      id: 'reg-1',
      status: 'pending',
      participantName: 'Riley Runner',
      guardianLabel: 'parent@example.com',
      guardianEmails: ['parent@example.com'],
      participant: { name: 'Riley Runner', grade: '5' },
      guardian: { email: 'parent@example.com', phone: '555-0100' },
      submittedData: {},
      submittedAt: null,
      selectedOptionLabel: 'Travel',
      paymentLabel: 'paid · $150.00',
      waiverAccepted: true,
      linkedPlayerId: '',
      decisionNote: '',
    }],
    rosterPlayers: [{ id: 'player-9', name: 'Riley Runner', number: '12' }],
  });
  parentRegistrationsServiceMocks.submitOfflineRegistration.mockResolvedValue({
    success: true,
    status: 'pending',
    registrationId: 'new-reg-1',
    feeSnapshot: { finalAmountDueCents: 10000, currency: 'USD' },
  });
  parentRegistrationsServiceMocks.initiateRegistrationCheckout.mockResolvedValue({
    success: true,
    checkoutUrl: 'https://checkout.stripe.com/c/pay-reg-1',
  });
  parentRegistrationsServiceMocks.acceptTeamRegistrationOfferForApp.mockResolvedValue({ success: true });
  parentRegistrationsServiceMocks.approveTeamRegistrationForApp.mockResolvedValue({ success: true });
  parentRegistrationsServiceMocks.extendTeamRegistrationOfferForApp.mockResolvedValue({ success: true });
  parentRegistrationsServiceMocks.rejectTeamRegistrationForApp.mockResolvedValue({ success: true });
  parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage.mockImplementation(async (_teamId, _formId, options = {}) => {
    if (options?.status === 'waitlisted') {
      return {
        reviews: [],
        lastDoc: null,
        hasMore: false,
      };
    }
    return {
      reviews: [{
        id: 'reg-1',
        status: 'pending',
        participantName: 'Riley Runner',
        guardianLabel: 'parent@example.com',
        guardianEmails: ['parent@example.com'],
        participant: { name: 'Riley Runner', grade: '5' },
        guardian: { email: 'parent@example.com', phone: '555-0100' },
        submittedData: {},
        submittedAt: null,
        selectedOptionLabel: 'Travel',
        paymentLabel: 'paid · $150.00',
        waiverAccepted: true,
        linkedPlayerId: '',
        decisionNote: '',
      }],
      lastDoc: { id: 'reg-1' },
      hasMore: false,
    };
  });
  parentRegistrationsServiceMocks.loadTeamRegistrationRosterPlayers.mockResolvedValue([
    { id: 'player-9', name: 'Riley Runner', number: '12' }
  ]);
  parentRegistrationsServiceMocks.cancelRegistrationCheckout.mockResolvedValue(undefined);
  publicActionsMocks.openPublicUrl.mockResolvedValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('selectInitialRegistrationOption', () => {
  it('returns the first option with pending placement before a waitlist option', () => {
    const form = { registrationOptionCounts: { waitlist: { enrolled: 10 }, open: { enrolled: 4 } } };
    const options = [
      { id: 'waitlist', countKey: 'waitlist', title: 'Waitlist', capacityLimit: 10, waitlistEnabled: true },
      { id: 'open', countKey: 'open', title: 'Open', capacityLimit: 10, waitlistEnabled: true },
    ];
    registrationFlowMocks.decideRegistrationPlacement.mockImplementation(({ selectedOptionId }) => (
      selectedOptionId === 'waitlist'
        ? { status: 'waitlisted' }
        : { status: 'pending' }
    ));

    expect(selectInitialRegistrationOption(form, options)).toBe('open');
  });

  it('falls back to the first option when every option is waitlist-only', () => {
    const form = { registrationOptionCounts: { first: { enrolled: 10 }, second: { enrolled: 10 } } };
    const options = [
      { id: 'first', countKey: 'first', title: 'First', capacityLimit: 10, waitlistEnabled: true },
      { id: 'second', countKey: 'second', title: 'Second', capacityLimit: 10, waitlistEnabled: true },
    ];
    registrationFlowMocks.decideRegistrationPlacement.mockReturnValue({ status: 'waitlisted' });

    expect(selectInitialRegistrationOption(form, options)).toBe('first');
  });

  it('returns an empty string when there are no options', () => {
    expect(selectInitialRegistrationOption({ registrationOptionCounts: {} }, [])).toBe('');
    expect(selectInitialRegistrationOption(null, [])).toBe('');
  });
});

describe('RegistrationDetail page', () => {
  it('renders the staff review queue and approves through the legacy app service with merge selection', async () => {
    const { container } = await renderStaffRegistrationReview();
    await waitForText(container, 'Travel Tryouts');
    await waitForText(container, 'Riley Runner');

    expect(parentRegistrationsServiceMocks.loadStaffRegistrationDetail).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1' }),
      'team-coach',
      'form-review'
    );
    expect(parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage).toHaveBeenNthCalledWith(
      1,
      'team-coach',
      'form-review'
    );
    expect(parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage).toHaveBeenNthCalledWith(
      2,
      'team-coach',
      'form-review',
      { status: 'waitlisted' }
    );
    expect(parentRegistrationsServiceMocks.loadTeamRegistrationRosterPlayers).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1' }),
      'team-coach'
    );
    expect(container.textContent).toContain('paid · $150.00');
    expect(container.textContent).toContain('Waiver accepted');

    await changeInputValue(container, 'Merge into existing roster player', 'player-9');
    await clickButton(container, 'Approve application');

    expect(parentRegistrationsServiceMocks.approveTeamRegistrationForApp).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1' }),
      'team-coach',
      'form-review',
      'reg-1',
      { playerId: 'player-9' }
    );
    await waitForText(container, 'Registration approved. Roster and parent links were updated using the legacy approval flow.');
  });

  it('allows staff review for closed registration forms', async () => {
    parentRegistrationsServiceMocks.loadStaffRegistrationDetail.mockResolvedValueOnce({
      teamName: 'Coach Bears',
      isPublished: false,
      onlineCheckout: false,
      legacyUrl: '/registration-review.html?teamId=team-coach&formId=form-review',
      form: {
        id: 'form-review',
        teamId: 'team-coach',
        programName: 'Travel Tryouts',
        description: 'Review queue',
        season: 'Spring',
        currency: 'USD',
        participantFields: [],
        guardianFields: [],
        registrationOptionCounts: {},
        status: 'closed',
        published: true,
      },
      options: [{ id: 'opt-1', title: 'Travel' }],
      feeSnapshot: { finalAmountDueCents: 15000, currency: 'USD' },
      paymentNotice: '',
      paymentPlans: [{ id: 'pay_full', title: 'Pay in full' }],
    });

    const { container } = await renderStaffRegistrationReview();
    await waitForText(container, 'Travel Tryouts');
    await waitForText(container, 'Riley Runner');

    expect(container.textContent).not.toContain('This linked registration form is not published right now.');
    expect(parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage).toHaveBeenNthCalledWith(
      1,
      'team-coach',
      'form-review'
    );
    expect(parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage).toHaveBeenNthCalledWith(
      2,
      'team-coach',
      'form-review',
      { status: 'waitlisted' }
    );
  });

  it('loads waitlisted applicants separately when they fall outside the first all-status page', async () => {
    parentRegistrationsServiceMocks.loadStaffRegistrationDetail.mockResolvedValueOnce({
      teamName: 'Coach Bears',
      isPublished: true,
      onlineCheckout: false,
      legacyUrl: '/registration-review.html?teamId=team-coach&formId=form-review',
      form: {
        id: 'form-review',
        teamId: 'team-coach',
        programName: 'Travel Tryouts',
        description: 'Review queue',
        season: 'Spring',
        currency: 'USD',
        participantFields: [],
        guardianFields: [],
        registrationOptionCounts: { 'opt-1': { enrolled: 25, waitlisted: 2 } },
        status: 'published',
        published: true,
      },
      options: [{ id: 'opt-1', countKey: 'opt-1', title: 'Travel', capacityLimit: 25 }],
      feeSnapshot: { finalAmountDueCents: 15000, currency: 'USD' },
      paymentNotice: '',
      paymentPlans: [{ id: 'pay_full', title: 'Pay in full' }],
    });
    parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage
      .mockResolvedValueOnce({
        reviews: [{
          id: 'reg-pending',
          status: 'pending',
          participantName: 'Pending Parker',
          guardianLabel: 'pending@example.com',
          guardianEmails: ['pending@example.com'],
          participant: { name: 'Pending Parker' },
          guardian: { email: 'pending@example.com' },
          submittedData: {},
          submittedAt: null,
          selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
          selectedOptionLabel: 'Travel',
          paymentLabel: 'unpaid · $150.00',
          waiverAccepted: true,
          linkedPlayerId: '',
          decisionNote: '',
        }],
        lastDoc: { id: 'reg-pending' },
        hasMore: true,
      })
      .mockResolvedValueOnce({
        reviews: [
          {
            id: 'reg-wait-1',
            status: 'waitlisted',
            participantName: 'Riley Runner',
            guardianLabel: 'riley@example.com',
            guardianEmails: ['riley@example.com'],
            participant: { name: 'Riley Runner' },
            guardian: { email: 'riley@example.com' },
            submittedData: {},
            submittedAt: '2026-06-20T18:00:00.000Z',
            selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
            selectedOptionLabel: 'Travel',
            paymentLabel: 'unpaid · $150.00',
            waiverAccepted: true,
            linkedPlayerId: '',
            decisionNote: '',
          },
          {
            id: 'reg-wait-2',
            status: 'waitlisted',
            participantName: 'Avery Ace',
            guardianLabel: 'avery@example.com',
            guardianEmails: ['avery@example.com'],
            participant: { name: 'Avery Ace' },
            guardian: { email: 'avery@example.com' },
            submittedData: {},
            submittedAt: '2026-06-20T17:00:00.000Z',
            selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
            selectedOptionLabel: 'Travel',
            paymentLabel: 'unpaid · $150.00',
            waiverAccepted: true,
            linkedPlayerId: '',
            decisionNote: '',
          },
        ],
        lastDoc: { id: 'reg-wait-2' },
        hasMore: false,
      });

    const { container } = await renderStaffRegistrationReview();
    await waitForText(container, 'Waitlisted applicants (2)');
    expect(container.textContent).toContain('Pending Parker');
    expect(container.textContent).toContain('Riley Runner');
    expect(container.textContent).toContain('Avery Ace');
    expect(parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage).toHaveBeenNthCalledWith(
      1,
      'team-coach',
      'form-review'
    );
    expect(parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage).toHaveBeenNthCalledWith(
      2,
      'team-coach',
      'form-review',
      { status: 'waitlisted' }
    );
  });

  it('lists waitlisted applicants in order and promotes them through the legacy waitlist flow', async () => {
    parentRegistrationsServiceMocks.loadStaffRegistrationDetail.mockResolvedValueOnce({
      teamName: 'Coach Bears',
      isPublished: true,
      onlineCheckout: false,
      legacyUrl: '/registration-review.html?teamId=team-coach&formId=form-review',
      form: {
        id: 'form-review',
        teamId: 'team-coach',
        programName: 'Travel Tryouts',
        description: 'Review queue',
        season: 'Spring',
        currency: 'USD',
        participantFields: [],
        guardianFields: [],
        registrationOptionCounts: { 'opt-1': { enrolled: 10, waitlisted: 2 } },
        status: 'published',
        published: true,
      },
      options: [{ id: 'opt-1', countKey: 'opt-1', title: 'Travel', capacityLimit: 10 }],
      feeSnapshot: { finalAmountDueCents: 15000, currency: 'USD' },
      paymentNotice: '',
      paymentPlans: [{ id: 'pay_full', title: 'Pay in full' }],
    });
    parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage
      .mockResolvedValueOnce({
        reviews: [
          {
            id: 'reg-pending',
            status: 'pending',
            participantName: 'Pending Parker',
            guardianLabel: 'pending@example.com',
            guardianEmails: ['pending@example.com'],
            participant: { name: 'Pending Parker' },
            guardian: { email: 'pending@example.com' },
            submittedData: {},
            submittedAt: null,
            selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
            selectedOptionLabel: 'Travel',
            paymentLabel: 'unpaid · $150.00',
            waiverAccepted: true,
            linkedPlayerId: '',
            decisionNote: '',
          },
          {
            id: 'reg-wait-1',
            status: 'waitlisted',
            participantName: 'Riley Runner',
            guardianLabel: 'riley@example.com',
            guardianEmails: ['riley@example.com'],
            participant: { name: 'Riley Runner' },
            guardian: { email: 'riley@example.com' },
            submittedData: {},
            submittedAt: '2026-06-20T18:00:00.000Z',
            selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
            selectedOptionLabel: 'Travel',
            paymentLabel: 'unpaid · $150.00',
            waiverAccepted: true,
            linkedPlayerId: '',
            decisionNote: '',
          },
          {
            id: 'reg-wait-2',
            status: 'waitlisted',
            participantName: 'Avery Ace',
            guardianLabel: 'avery@example.com',
            guardianEmails: ['avery@example.com'],
            participant: { name: 'Avery Ace' },
            guardian: { email: 'avery@example.com' },
            submittedData: {},
            submittedAt: '2026-06-20T17:00:00.000Z',
            selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
            selectedOptionLabel: 'Travel',
            paymentLabel: 'unpaid · $150.00',
            waiverAccepted: true,
            linkedPlayerId: '',
            decisionNote: '',
          },
        ],
        lastDoc: { id: 'reg-wait-2' },
        hasMore: false,
      })
      .mockResolvedValueOnce({
        reviews: [
          {
            id: 'reg-wait-1',
            status: 'waitlisted',
            participantName: 'Riley Runner',
            guardianLabel: 'riley@example.com',
            guardianEmails: ['riley@example.com'],
            participant: { name: 'Riley Runner' },
            guardian: { email: 'riley@example.com' },
            submittedData: {},
            submittedAt: '2026-06-20T18:00:00.000Z',
            selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
            selectedOptionLabel: 'Travel',
            paymentLabel: 'unpaid · $150.00',
            waiverAccepted: true,
            linkedPlayerId: '',
            decisionNote: '',
          },
          {
            id: 'reg-wait-2',
            status: 'waitlisted',
            participantName: 'Avery Ace',
            guardianLabel: 'avery@example.com',
            guardianEmails: ['avery@example.com'],
            participant: { name: 'Avery Ace' },
            guardian: { email: 'avery@example.com' },
            submittedData: {},
            submittedAt: '2026-06-20T17:00:00.000Z',
            selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
            selectedOptionLabel: 'Travel',
            paymentLabel: 'unpaid · $150.00',
            waiverAccepted: true,
            linkedPlayerId: '',
            decisionNote: '',
          },
        ],
        lastDoc: { id: 'reg-wait-2' },
        hasMore: false,
      })
      .mockResolvedValueOnce({
        reviews: [
          {
            id: 'reg-pending',
            status: 'pending',
            participantName: 'Pending Parker',
            guardianLabel: 'pending@example.com',
            guardianEmails: ['pending@example.com'],
            participant: { name: 'Pending Parker' },
            guardian: { email: 'pending@example.com' },
            submittedData: {},
            submittedAt: null,
            selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
            selectedOptionLabel: 'Travel',
            paymentLabel: 'unpaid · $150.00',
            waiverAccepted: true,
            linkedPlayerId: '',
            decisionNote: '',
          },
          {
            id: 'reg-wait-1',
            status: 'offer-extended',
            participantName: 'Riley Runner',
            guardianLabel: 'riley@example.com',
            guardianEmails: ['riley@example.com'],
            participant: { name: 'Riley Runner' },
            guardian: { email: 'riley@example.com' },
            submittedData: {},
            submittedAt: '2026-06-20T18:00:00.000Z',
            selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
            selectedOptionLabel: 'Travel',
            paymentLabel: 'unpaid · $150.00',
            waiverAccepted: true,
            linkedPlayerId: '',
            decisionNote: '',
          },
          {
            id: 'reg-wait-2',
            status: 'waitlisted',
            participantName: 'Avery Ace',
            guardianLabel: 'avery@example.com',
            guardianEmails: ['avery@example.com'],
            participant: { name: 'Avery Ace' },
            guardian: { email: 'avery@example.com' },
            submittedData: {},
            submittedAt: '2026-06-20T17:00:00.000Z',
            selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
            selectedOptionLabel: 'Travel',
            paymentLabel: 'unpaid · $150.00',
            waiverAccepted: true,
            linkedPlayerId: '',
            decisionNote: '',
          },
        ],
        lastDoc: { id: 'reg-wait-2' },
        hasMore: false,
      })
      .mockResolvedValueOnce({
        reviews: [
          {
            id: 'reg-wait-2',
            status: 'waitlisted',
            participantName: 'Avery Ace',
            guardianLabel: 'avery@example.com',
            guardianEmails: ['avery@example.com'],
            participant: { name: 'Avery Ace' },
            guardian: { email: 'avery@example.com' },
            submittedData: {},
            submittedAt: '2026-06-20T17:00:00.000Z',
            selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
            selectedOptionLabel: 'Travel',
            paymentLabel: 'unpaid · $150.00',
            waiverAccepted: true,
            linkedPlayerId: '',
            decisionNote: '',
          },
        ],
        lastDoc: { id: 'reg-wait-2' },
        hasMore: false,
      });

    const { container } = await renderStaffRegistrationReview();
    await waitForText(container, 'Waitlisted applicants (2)');

    const waitlistList = container.querySelector('[data-waitlist-list]');
    expect(waitlistList).toBeTruthy();
    expect(waitlistList.textContent.indexOf('Riley Runner')).toBeLessThan(waitlistList.textContent.indexOf('Avery Ace'));

    await clickButton(container, 'Riley Runner');
    await waitForText(container, 'Current capacity');
    expect(container.textContent).toContain('0 spots left');

    await clickButton(container, 'Promote from waitlist');

    expect(parentRegistrationsServiceMocks.extendTeamRegistrationOfferForApp).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1' }),
      'team-coach',
      'form-review',
      'reg-wait-1'
    );
    await waitForText(container, 'Waitlist offer extended using the legacy registration flow.');
    await waitForText(container, 'Waitlisted applicants (1)');
  });

  it('marks extended waitlist offers accepted through the legacy waitlist flow', async () => {
    parentRegistrationsServiceMocks.loadTeamRegistrationQueuePage
      .mockResolvedValueOnce({
        reviews: [{
          id: 'reg-offer-1',
          status: 'offer-extended',
          participantName: 'Riley Runner',
          guardianLabel: 'riley@example.com',
          guardianEmails: ['riley@example.com'],
          participant: { name: 'Riley Runner' },
          guardian: { email: 'riley@example.com' },
          submittedData: {},
          submittedAt: '2026-06-20T18:00:00.000Z',
          selectedOption: { id: 'opt-1', countKey: 'opt-1', title: 'Travel' },
          selectedOptionLabel: 'Travel',
          paymentLabel: 'unpaid · $150.00',
          waiverAccepted: true,
          linkedPlayerId: '',
          decisionNote: '',
        }],
        lastDoc: { id: 'reg-offer-1' },
        hasMore: false,
      })
      .mockResolvedValueOnce({
        reviews: [],
        lastDoc: null,
        hasMore: false,
      });

    const { container } = await renderStaffRegistrationReview();
    await waitForText(container, 'Riley Runner');
    await waitForText(container, 'Mark accepted');

    expect(container.textContent).not.toContain('Merge into existing roster player');

    await clickButton(container, 'Mark accepted');

    expect(parentRegistrationsServiceMocks.acceptTeamRegistrationOfferForApp).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1' }),
      'team-coach',
      'form-review',
      'reg-offer-1'
    );
    await waitForText(container, 'Waitlist offer marked accepted. This registration can now be approved to the roster.');
  });

  it('defaults the selected option to the first option with available capacity', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        description: 'Skills week',
        season: 'Summer',
        feeLabel: '$75.00',
        paymentNotice: 'Offline payment accepted.',
        onlineCheckout: false,
        options: [
          { id: 'waitlist_only', title: 'Waitlist first', countKey: 'waitlist_only', capacityLimit: 10, waitlistEnabled: true },
          { id: 'open_option', title: 'Open second', countKey: 'open_option', capacityLimit: 10, waitlistEnabled: true },
        ],
        registrationOptionCounts: {
          waitlist_only: { enrolled: 10, waitlisted: 0 },
          open_option: { enrolled: 5, waitlisted: 0 },
        },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
        url: '/registration.html?teamId=team-1&formId=form-1',
        discountRules: [],
      },
    ]);
    registrationFlowMocks.decideRegistrationPlacement.mockImplementation(({ selectedOptionId }) => ({
      status: selectedOptionId === 'waitlist_only' ? 'waitlisted' : 'pending',
      message: selectedOptionId === 'waitlist_only' ? 'Placement waitlisted' : 'Placement pending',
      selectedOption: selectedOptionId ? { id: selectedOptionId, countKey: selectedOptionId } : null,
      nextCounts: { enrolled: selectedOptionId === 'waitlist_only' ? 10 : 6, waitlisted: 0 },
    }));

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    expect(container.querySelector('[data-selected-option]')?.value).toBe('open_option');
    expect(container.textContent).toContain('5 spots left');
  });

  it('loads a public registration route from query params without linked family access', async () => {
    const { container } = await renderPublicRegistrationDetail();
    await waitForText(container, 'Open Clinic');

    expect(parentRegistrationsServiceMocks.loadPublicRegistrationDetail).toHaveBeenCalledWith('team-public', 'form-public');
    expect(parentRegistrationsServiceMocks.loadParentRegistrations).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Public Bears');
    expect(container.textContent).not.toContain('Back to registrations');
  });

  it('blocks submit for unavailable public registration links', async () => {
    parentRegistrationsServiceMocks.loadPublicRegistrationDetail.mockRejectedValueOnce(new Error('This registration form is not available right now.'));
    const { container } = await renderPublicRegistrationDetail();

    await waitForText(container, 'This registration form is not available right now.');
    expect(container.textContent).toContain('Registration unavailable');
    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();
  });

  it('renders the form and handles submission successfully', async () => {
    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await ensureRegistrationOptionResolved(container); // Assuming select is handled by option value

    await clickButton(container, 'Submit registration');

    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).toHaveBeenCalledTimes(1);
    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      expect.objectContaining({
        participant: { name: 'Test Participant' },
        guardian: { name: 'Test Guardian' },
        waiverAccepted: true,
        selectedOption: expect.objectContaining({ id: 'opt-1' }),
        selectedOptionId: 'opt-1',
      })
    );
    await waitForText(container, 'Registration submitted. Your registration is pending review.');
  });

  it('hides the payment plan selector for a single pay-in-full plan and submits the default', async () => {
    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    expect(container.querySelector('[data-payment-plan]')).toBeNull();
    expect(container.textContent).not.toContain('Payment plan');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await ensureRegistrationOptionResolved(container);
    await clickButton(container, 'Submit registration');

    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      expect.objectContaining({
        selectedPaymentPlanId: 'pay_full',
      })
    );
  });

  it('shows the payment plan selector for multiple choices and submits the selected plan', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        season: 'Summer',
        onlineCheckout: false,
        paymentPlans: [
          { id: 'pay_full', title: 'Pay in full' },
          { id: 'installments', title: 'Installment plan' },
        ],
        options: [{ id: 'opt-1', title: 'Option 1' }],
        registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
      },
    ]);

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    expect(container.querySelector('[data-payment-plan]')).not.toBeNull();
    expect(container.textContent).toContain('Payment plan');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await ensureRegistrationOptionResolved(container);
    await changeInputValue(container, 'Payment plan', 'installments');
    await clickButton(container, 'Submit registration');

    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      expect.objectContaining({
        selectedPaymentPlanId: 'installments',
      })
    );
  });

  it('shows an error if required fields are missing', async () => {
    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    await clickButton(container, 'Submit registration');
    await waitForText(container, 'Participant Name is required.');
    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await clickButton(container, 'Submit registration');
    await waitForText(container, 'Guardian Name is required.');
    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();

    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await clickButton(container, 'Submit registration');
    await waitForText(container, 'Accept the waiver to submit.');
    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();
  });

  it('shows a waitlisted message if placement status is waitlisted', async () => {
    parentRegistrationsServiceMocks.submitOfflineRegistration.mockResolvedValueOnce({
      success: true,
      status: 'waitlisted',
      registrationId: 'new-reg-waitlisted',
    });
    registrationFlowMocks.decideRegistrationPlacement.mockReturnValueOnce({
      status: 'waitlisted',
      message: 'Placement waitlisted',
      selectedOption: { id: 'opt-1', countKey: 'opt-1' },
      nextCounts: { enrolled: 10, waitlisted: 1 },
    });

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await ensureRegistrationOptionResolved(container);

    await clickButton(container, 'Submit registration');

    await waitForText(container, 'Registration submitted. You have been added to the waitlist.');
  });

  it('shows a blocked message if placement status is blocked', async () => {
    registrationFlowMocks.decideRegistrationPlacement.mockReturnValue({
      status: 'blocked',
      message: 'Option is full and not accepting waitlist registrations.',
      selectedOption: { id: 'opt-1', countKey: 'opt-1' },
      nextCounts: { enrolled: 10, waitlisted: 0 },
    });

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await ensureRegistrationOptionResolved(container);

    await clickButton(container, 'Submit registration');

    await waitForText(container, 'Option is full and not accepting waitlist registrations.');
    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();
  });

  it('launches Stripe checkout for online checkout forms', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        description: 'Skills week',
        season: 'Summer',
        currency: 'USD',
        feeLabel: '$75.00',
        paymentNotice: 'Online payment required.',
        onlineCheckout: true,
        options: [{ id: 'opt-1', title: 'Option 1' }],
        registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
        url: '/registration.html?teamId=team-1&formId=form-1',
      },
    ]);

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Pay registration with Stripe');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await ensureRegistrationOptionResolved(container);

    await clickButton(container, 'Pay registration with Stripe');

    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).toHaveBeenCalledTimes(1);
    expect(parentRegistrationsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      'new-reg-1',
      'opt-1',
      'pay_full',
      1,
      10000,
      'USD',
      expect.objectContaining({
        checkoutAttemptToken: expect.any(String)
      })
    );
    expect(publicActionsMocks.openPublicUrl).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay-reg-1');
  });

  it('keeps online checkout validation before creating a registration', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        season: 'Summer',
        onlineCheckout: true,
        options: [{ id: 'opt-1', title: 'Option 1' }],
        registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
      },
    ]);

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Pay registration with Stripe');

    await clickButton(container, 'Pay registration with Stripe');

    await waitForText(container, 'Participant Name is required.');
    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();
    expect(parentRegistrationsServiceMocks.initiateRegistrationCheckout).not.toHaveBeenCalled();
    expect(publicActionsMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('does not launch checkout for waitlisted online checkout registrations', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        season: 'Summer',
        currency: 'USD',
        onlineCheckout: true,
        options: [{ id: 'opt-1', title: 'Option 1' }],
        registrationOptionCounts: { 'opt-1': { enrolled: 10, waitlisted: 0 } },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
      },
    ]);
    parentRegistrationsServiceMocks.submitOfflineRegistration.mockResolvedValueOnce({
      success: true,
      status: 'waitlisted',
      registrationId: 'new-reg-waitlisted',
    });

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Pay registration with Stripe');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await ensureRegistrationOptionResolved(container);
    await clickButton(container, 'Pay registration with Stripe');

    await waitForText(container, 'Registration submitted. You have been added to the waitlist.');
    expect(parentRegistrationsServiceMocks.initiateRegistrationCheckout).not.toHaveBeenCalled();
    expect(publicActionsMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('shows a post-registration error when checkout creation fails', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        season: 'Summer',
        currency: 'USD',
        onlineCheckout: true,
        options: [{ id: 'opt-1', title: 'Option 1' }],
        registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
      },
    ]);
    parentRegistrationsServiceMocks.initiateRegistrationCheckout.mockRejectedValueOnce(new Error('Stripe session failed.'));

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Pay registration with Stripe');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await ensureRegistrationOptionResolved(container);
    await clickButton(container, 'Pay registration with Stripe');

    await waitForText(container, 'Registration created, but checkout could not be opened. Stripe session failed.');
    expect(publicActionsMocks.openPublicUrl).not.toHaveBeenCalled();
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Pay registration with Stripe')).disabled).toBe(false);
  });

  it('shows a post-registration error when checkout URL opening fails', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        season: 'Summer',
        currency: 'USD',
        onlineCheckout: true,
        options: [{ id: 'opt-1', title: 'Option 1' }],
        registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
      },
    ]);
    publicActionsMocks.openPublicUrl.mockRejectedValueOnce(new Error('Popup blocked.'));

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Pay registration with Stripe');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await ensureRegistrationOptionResolved(container);
    await clickButton(container, 'Pay registration with Stripe');

    await waitForText(container, 'Registration created, but checkout could not be opened. Popup blocked.');
    expect(parentRegistrationsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledTimes(1);
  });

  it('supports online checkout forms without registration options', async () => {
    registrationFlowMocks.requiresRegistrationOption
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);
    registrationFlowMocks.getActiveRegistrationOptions.mockReturnValueOnce([]);
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        season: 'Summer',
        currency: 'USD',
        onlineCheckout: true,
        options: [],
        registrationOptionCounts: {},
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
      },
    ]);

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Pay registration with Stripe');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await clickButton(container, 'Pay registration with Stripe');

    expect(parentRegistrationsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      'new-reg-1',
      '',
      'pay_full',
      1,
      10000,
      'USD',
      expect.objectContaining({
        checkoutAttemptToken: expect.any(String)
      })
    );
    expect(publicActionsMocks.openPublicUrl).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay-reg-1');
  });

  it('renders fee summary rows and updates them when quantity changes', async () => {
    registrationFlowMocks.hasQuantityDiscountRule.mockReturnValueOnce(true);
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        season: 'Summer',
        currency: 'USD',
        feeAmountCents: 10000,
        paymentNotice: 'Offline payment accepted.',
        onlineCheckout: false,
        options: [{ id: 'opt-1', title: 'Option 1' }],
        registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
        url: '/registration.html?teamId=team-1&formId=form-1',
        discountRules: [{ id: 'qty-disc', type: 'quantity', active: true, amountType: 'fixed', amountValue: 2500, minimumQuantity: 2 }],
      },
    ]);
    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    expect(container.textContent).toContain('Fee summary');
    expect(container.textContent).toContain('Original fee');
    expect(container.textContent).toContain('$100.00');
    expect(container.textContent).toContain('Final amount due');

    await changeInputValue(container, 'Quantity', '2');

    expect(container.textContent).toContain('Sibling discount');
    expect(container.textContent).toContain('-$25.00');
    expect(container.textContent).toContain('$175.00');
  });

  it('does not let a loaded fee snapshot freeze the displayed quantity total', async () => {
    registrationFlowMocks.hasQuantityDiscountRule.mockReturnValueOnce(true);
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        season: 'Summer',
        currency: 'USD',
        feeAmountCents: 10000,
        feeSnapshot: { originalFeeAmountCents: 10000, subtotalAmountCents: 10000, appliedDiscounts: [], finalAmountDueCents: 10000, currency: 'USD' },
        onlineCheckout: false,
        options: [{ id: 'opt-1', title: 'Option 1' }],
        registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
        discountRules: [{ id: 'qty-disc', type: 'quantity', active: true, amountType: 'fixed', amountValue: 2500, minimumQuantity: 2 }],
      },
    ]);

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');
    await changeInputValue(container, 'Quantity', '3');

    expect(registrationFlowMocks.calculateRegistrationFeeSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ feeSnapshot: expect.objectContaining({ finalAmountDueCents: 10000 }) }),
      expect.objectContaining({ quantity: 3, now: expect.any(Date) })
    );
    expect(container.textContent).toContain('Sibling discount');
    expect(container.textContent).toContain('$275.00');
  });

  it('uses the server-returned registration fee for checkout', async () => {
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        season: 'Summer',
        currency: 'USD',
        onlineCheckout: true,
        options: [{ id: 'opt-1', title: 'Option 1' }],
        registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
      },
    ]);
    parentRegistrationsServiceMocks.submitOfflineRegistration.mockResolvedValueOnce({
      success: true,
      status: 'pending',
      registrationId: 'new-reg-1',
      feeSnapshot: { finalAmountDueCents: 12500, currency: 'cad' },
    });

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Pay registration with Stripe');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await ensureRegistrationOptionResolved(container);
    await clickButton(container, 'Pay registration with Stripe');

    expect(parentRegistrationsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      'new-reg-1',
      'opt-1',
      'pay_full',
      1,
      12500,
      'cad',
      expect.objectContaining({
        checkoutAttemptToken: expect.any(String)
      })
    );
  });

  it('does not render Quantity input for a form with no quantity discount rules', async () => {
    // Default beforeEach setup has no discountRules, so hasQuantityDiscountRule should be false
    registrationFlowMocks.hasQuantityDiscountRule.mockReturnValueOnce(false);
    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    expect(container.querySelector('[data-quantity-field]')).toBeNull();
    expect(container.textContent).not.toContain('Quantity');
  });

  it('passes quantity=1 to submission and checkout when Quantity is hidden', async () => {
    registrationFlowMocks.hasQuantityDiscountRule.mockReturnValueOnce(false);
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        season: 'Summer',
        currency: 'USD',
        onlineCheckout: true,
        options: [{ id: 'opt-1', title: 'Option 1' }],
        registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
        discountRules: [],
      },
    ]);

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await ensureRegistrationOptionResolved(container);
    await clickButton(container, 'Pay registration with Stripe');

    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      expect.objectContaining({
        quantity: 1, // Should be 1 because hasQuantityDiscountRule is false
      })
    );
    expect(parentRegistrationsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      'new-reg-1',
      'opt-1',
      'pay_full',
      1, // Should be 1 because hasQuantityDiscountRule is false
      expect.any(Number),
      expect.any(String),
      expect.objectContaining({
        checkoutAttemptToken: expect.any(String)
      })
    );
  });

  it('renders Quantity and updates fee summary when an active quantity discount rule exists', async () => {
    registrationFlowMocks.hasQuantityDiscountRule.mockReturnValueOnce(true);
    parentRegistrationsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
      {
        id: 'form-1',
        teamId: 'team-1',
        teamName: 'Bears',
        programName: 'Summer Camp',
        season: 'Summer',
        currency: 'USD',
        feeAmountCents: 10000,
        onlineCheckout: true,
        options: [{ id: 'opt-1', title: 'Option 1' }],
        registrationOptionCounts: { 'opt-1': { enrolled: 0, waitlisted: 0 } },
        participantFields: [{ id: 'name', label: 'Participant Name', type: 'text', required: true }],
        guardianFields: [{ id: 'name', label: 'Guardian Name', type: 'text', required: true }],
        waiverText: 'I agree to the terms and conditions.',
        discountRules: [{ id: 'qty-disc', type: 'quantity', active: true, amountType: 'fixed', amountValue: 2500, minimumQuantity: 2 }],
      },
    ]);

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    expect(container.textContent).toContain('Quantity'); // Quantity field should be visible
    expect(container.querySelector('[data-quantity-field]')).not.toBeNull();

    expect(container.textContent).toContain('Original fee');
    expect(container.textContent).toContain('$100.00'); // For quantity 1
    expect(container.textContent).toContain('Final amount due');
    expect(container.textContent).toContain('$100.00');

    await changeInputValue(container, 'Quantity', '2');

    // Verify fee summary updates with discount
    expect(container.textContent).toContain('Sibling discount'); // The mock calculateRegistrationFeeSnapshot adds this
    expect(container.textContent).toContain('-$25.00');
    expect(container.textContent).toContain('$175.00'); // (100*2) - 25 = 175

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await ensureRegistrationOptionResolved(container);
    await clickButton(container, 'Pay registration with Stripe');

    expect(parentRegistrationsServiceMocks.submitOfflineRegistration).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      expect.objectContaining({
        quantity: 2, // Should be 2 because hasQuantityDiscountRule is true and input was changed
      })
    );
    expect(parentRegistrationsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      'new-reg-1',
      'opt-1',
      'pay_full',
      2, // Should be 2 because hasQuantityDiscountRule is true and input was changed
      expect.any(Number),
      expect.any(String),
      expect.objectContaining({
        checkoutAttemptToken: expect.any(String)
      })
    );
  });

});
