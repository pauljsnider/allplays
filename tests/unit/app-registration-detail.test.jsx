// @vitest-environment jsdom
import React, { act } from '../../apps/app/node_modules/react/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../../apps/app/node_modules/react-dom/client.js';
import { MemoryRouter, Route, Routes } from '../../apps/app/node_modules/react-router-dom/dist/index.mjs';

// Mock parentToolsService
const parentToolsServiceMocks = vi.hoisted(() => ({
  loadParentRegistrations: vi.fn(),
  submitOfflineRegistration: vi.fn(),
  initiateRegistrationCheckout: vi.fn(),
}));

const publicActionsMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn(),
}));

// Mock registration-flow.js
const registrationFlowMocks = vi.hoisted(() => ({
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
    const appliedDiscounts = quantity >= 2 ? [{ id: 'sibling', label: 'Sibling discount', amountCents: 2500 }] : [];
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
}));

vi.mock('../../apps/app/src/lib/parentToolsService.ts', () => parentToolsServiceMocks);
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionsMocks);
vi.mock('../../js/registration-flow.js', () => registrationFlowMocks);

import { RegistrationDetail } from '../../apps/app/src/pages/RegistrationDetail.tsx';

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

beforeEach(() => {
  vi.clearAllMocks();
  parentToolsServiceMocks.loadParentRegistrations.mockResolvedValue([
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
    },
  ]);
  parentToolsServiceMocks.submitOfflineRegistration.mockResolvedValue({
    success: true,
    status: 'pending',
    registrationId: 'new-reg-1',
    feeSnapshot: { finalAmountDueCents: 10000, currency: 'USD' },
  });
  parentToolsServiceMocks.initiateRegistrationCheckout.mockResolvedValue({
    success: true,
    checkoutUrl: 'https://checkout.stripe.com/c/pay-reg-1',
  });
  publicActionsMocks.openPublicUrl.mockResolvedValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RegistrationDetail page', () => {
  it('renders the form and handles submission successfully', async () => {
    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await changeInputValue(container, 'Registration option', 'opt-1'); // Assuming select is handled by option value

    await clickButton(container, 'Submit registration');

    expect(parentToolsServiceMocks.submitOfflineRegistration).toHaveBeenCalledTimes(1);
    expect(parentToolsServiceMocks.submitOfflineRegistration).toHaveBeenCalledWith(
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

  it('shows an error if required fields are missing', async () => {
    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Summer Camp');

    await clickButton(container, 'Submit registration');
    await waitForText(container, 'Participant Name is required.');
    expect(parentToolsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await clickButton(container, 'Submit registration');
    await waitForText(container, 'Guardian Name is required.');
    expect(parentToolsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();

    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await clickButton(container, 'Submit registration');
    await waitForText(container, 'Accept the waiver to submit.');
    expect(parentToolsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();
  });

  it('shows a waitlisted message if placement status is waitlisted', async () => {
    parentToolsServiceMocks.submitOfflineRegistration.mockResolvedValueOnce({
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
    await changeInputValue(container, 'Registration option', 'opt-1');

    await clickButton(container, 'Submit registration');

    await waitForText(container, 'Registration submitted. You have been added to the waitlist.');
  });

  it('shows a blocked message if placement status is blocked', async () => {
    registrationFlowMocks.decideRegistrationPlacement.mockReturnValueOnce({
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
    await changeInputValue(container, 'Registration option', 'opt-1');

    await clickButton(container, 'Submit registration');

    await waitForText(container, 'Option is full and not accepting waitlist registrations.');
    expect(parentToolsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();
  });

  it('launches Stripe checkout for online checkout forms', async () => {
    parentToolsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
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
    await changeInputValue(container, 'Registration option', 'opt-1');

    await clickButton(container, 'Pay registration with Stripe');

    expect(parentToolsServiceMocks.submitOfflineRegistration).toHaveBeenCalledTimes(1);
    expect(parentToolsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      'new-reg-1',
      'opt-1',
      'pay_full',
      1,
      10000,
      'USD'
    );
    expect(publicActionsMocks.openPublicUrl).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay-reg-1');
  });

  it('keeps online checkout validation before creating a registration', async () => {
    parentToolsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
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
    expect(parentToolsServiceMocks.submitOfflineRegistration).not.toHaveBeenCalled();
    expect(parentToolsServiceMocks.initiateRegistrationCheckout).not.toHaveBeenCalled();
    expect(publicActionsMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('does not launch checkout for waitlisted online checkout registrations', async () => {
    parentToolsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
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
    parentToolsServiceMocks.submitOfflineRegistration.mockResolvedValueOnce({
      success: true,
      status: 'waitlisted',
      registrationId: 'new-reg-waitlisted',
    });

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Pay registration with Stripe');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await changeInputValue(container, 'Registration option', 'opt-1');
    await clickButton(container, 'Pay registration with Stripe');

    await waitForText(container, 'Registration submitted. You have been added to the waitlist.');
    expect(parentToolsServiceMocks.initiateRegistrationCheckout).not.toHaveBeenCalled();
    expect(publicActionsMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('shows a post-registration error when checkout creation fails', async () => {
    parentToolsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
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
    parentToolsServiceMocks.initiateRegistrationCheckout.mockRejectedValueOnce(new Error('Stripe session failed.'));

    const { container } = await renderRegistrationDetail();
    await waitForText(container, 'Pay registration with Stripe');

    await changeInputValue(container, 'Participant Name', 'Test Participant');
    await changeInputValue(container, 'Guardian Name', 'Test Guardian');
    await changeInputValue(container, 'I accept the waiver.', true);
    await changeInputValue(container, 'Registration option', 'opt-1');
    await clickButton(container, 'Pay registration with Stripe');

    await waitForText(container, 'Registration created, but checkout could not be opened. Stripe session failed.');
    expect(publicActionsMocks.openPublicUrl).not.toHaveBeenCalled();
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Pay registration with Stripe')).disabled).toBe(false);
  });

  it('shows a post-registration error when checkout URL opening fails', async () => {
    parentToolsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
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
    await changeInputValue(container, 'Registration option', 'opt-1');
    await clickButton(container, 'Pay registration with Stripe');

    await waitForText(container, 'Registration created, but checkout could not be opened. Popup blocked.');
    expect(parentToolsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledTimes(1);
  });

  it('supports online checkout forms without registration options', async () => {
    registrationFlowMocks.requiresRegistrationOption
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);
    registrationFlowMocks.getActiveRegistrationOptions.mockReturnValueOnce([]);
    parentToolsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
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

    expect(parentToolsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      'new-reg-1',
      '',
      'pay_full',
      1,
      10000,
      'USD'
    );
    expect(publicActionsMocks.openPublicUrl).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay-reg-1');
  });

  it('renders fee summary rows and updates them when quantity changes', async () => {
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
    parentToolsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
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
    parentToolsServiceMocks.loadParentRegistrations.mockResolvedValueOnce([
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
    parentToolsServiceMocks.submitOfflineRegistration.mockResolvedValueOnce({
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
    await changeInputValue(container, 'Registration option', 'opt-1');
    await clickButton(container, 'Pay registration with Stripe');

    expect(parentToolsServiceMocks.initiateRegistrationCheckout).toHaveBeenCalledWith(
      'team-1',
      'form-1',
      'new-reg-1',
      'opt-1',
      'pay_full',
      1,
      12500,
      'cad'
    );
  });

});
