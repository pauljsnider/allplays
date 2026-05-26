import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = {
  currentUser: { uid: 'parent-123' },
  onAuthStateChanged: vi.fn()
};
const mockGetDocs = vi.fn();
const mockGetDoc = vi.fn();
const mockRecipientsRef = {};
const mockDb = {};

vi.mock('@angular/core', () => ({
  Component: () => () => undefined,
  OnInit: class {}
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => mockAuth)
}));

vi.mock('firebase/firestore', () => ({
  collectionGroup: vi.fn(() => mockRecipientsRef),
  doc: vi.fn((...args) => ({ args })),
  getDoc: mockGetDoc,
  getDocs: mockGetDocs,
  getFirestore: vi.fn(() => mockDb),
  query: vi.fn((...args) => ({ args })),
  where: vi.fn((field, operator, value) => ({ field, operator, value }))
}));

vi.mock('../firebase-config', () => ({
  app: {}
}));

vi.mock('../shared/services/stripe.service', () => ({
  StripeService: class {}
}));

const { TeamFeesComponent } = await import('./team-fees.component');
const { collectionGroup, doc, getDoc, getFirestore, query, where } = await import('firebase/firestore');

const template = readFileSync(resolve(process.cwd(), 'src/app/team-fees/team-fees.component.html'), 'utf8');

function feeDoc(path: string, id: string, data: Record<string, unknown>) {
  return {
    id,
    ref: { path },
    data: () => data
  };
}

describe('TeamFeesComponent checkout flow', () => {
  let stripeService: { initiateTeamFeeCheckout: ReturnType<typeof vi.fn> };
  let component: InstanceType<typeof TeamFeesComponent>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.currentUser = { uid: 'parent-123' };
    mockAuth.onAuthStateChanged.mockReset();
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    mockGetDocs.mockResolvedValue({ docs: [] });
    stripeService = {
      initiateTeamFeeCheckout: vi.fn().mockResolvedValue('https://checkout.stripe.com/team-fee-session')
    };
    component = new TeamFeesComponent(stripeService as never);
  });

  it('loads only the signed-in user fee recipient records from Firestore', async () => {
    const feeOne = feeDoc('teams/team-real/feeBatches/batch-real/feeRecipients/recipient-real', 'recipient-real', {
      parentUserId: 'parent-123',
      title: 'Spring registration',
      balanceDueCents: 12500,
      status: 'unpaid'
    });
    const paidFee = feeDoc('teams/team-real/feeBatches/batch-paid/feeRecipients/recipient-paid', 'recipient-paid', {
      userId: 'parent-123',
      feeTitle: 'Uniform fee',
      amountCents: 5000,
      status: 'paid'
    });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [feeOne] })
      .mockResolvedValueOnce({ docs: [feeOne] })
      .mockResolvedValueOnce({ docs: [paidFee] });

    await component.ngOnInit();

    expect(getFirestore).toHaveBeenCalledWith({});
    expect(collectionGroup).toHaveBeenCalledWith(mockDb, 'feeRecipients');
    expect(where).toHaveBeenCalledWith('parentUserId', '==', 'parent-123');
    expect(where).toHaveBeenCalledWith('accountUserId', '==', 'parent-123');
    expect(where).toHaveBeenCalledWith('userId', '==', 'parent-123');
    expect(query).toHaveBeenCalledTimes(3);
    expect(component.teamFees).toEqual([
      {
        id: 'recipient-real',
        teamId: 'team-real',
        batchId: 'batch-real',
        recipientId: 'recipient-real',
        name: 'Spring registration',
        amount: 125,
        isPaid: false
      },
      {
        id: 'recipient-paid',
        teamId: 'team-real',
        batchId: 'batch-paid',
        recipientId: 'recipient-paid',
        name: 'Uniform fee',
        amount: 50,
        isPaid: true
      }
    ]);
    expect(component.isLoadingFees).toBe(false);
  });

  it('deduplicates overlapping fee recipient query results before mapping fees', async () => {
    const feeOne = feeDoc('teams/team-real/feeBatches/batch-real/feeRecipients/recipient-real', 'recipient-real', {
      parentUserId: 'parent-123',
      title: 'Spring registration',
      balanceDueCents: 12500,
      status: 'unpaid'
    });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [feeOne, feeOne] })
      .mockResolvedValueOnce({ docs: [feeOne] })
      .mockResolvedValueOnce({ docs: [] });

    await component.ngOnInit();

    expect(component.teamFees).toEqual([
      {
        id: 'recipient-real',
        teamId: 'team-real',
        batchId: 'batch-real',
        recipientId: 'recipient-real',
        name: 'Spring registration',
        amount: 125,
        isPaid: false
      }
    ]);
  });

  it('loads parent-assigned fee recipients by linked team and player when records omit user IDs', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ parentOf: [{ teamId: 'team-real', playerId: 'player-real' }] })
    });
    const playerFee = feeDoc('teams/team-real/feeBatches/batch-real/feeRecipients/player-real', 'player-real', {
      teamId: 'team-real',
      playerId: 'player-real',
      feeTitle: 'Roster fee',
      amountCents: 7500,
      status: 'unpaid'
    });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [playerFee] });

    await component.ngOnInit();

    expect(doc).toHaveBeenCalledWith(mockDb, 'users', 'parent-123');
    expect(getDoc).toHaveBeenCalled();
    expect(where).toHaveBeenCalledWith('teamId', '==', 'team-real');
    expect(where).toHaveBeenCalledWith('playerId', '==', 'player-real');
    expect(query).toHaveBeenCalledTimes(4);
    expect(component.teamFees).toEqual([
      {
        id: 'player-real',
        teamId: 'team-real',
        batchId: 'batch-real',
        recipientId: 'player-real',
        name: 'Roster fee',
        amount: 75,
        isPaid: false
      }
    ]);
  });

  it('does not populate hard-coded mock team fees when no user is signed in', async () => {
    mockAuth.currentUser = null;
    mockAuth.onAuthStateChanged.mockImplementation((next: (user: null) => void) => {
      next(null);
      return () => undefined;
    });

    await component.ngOnInit();

    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(component.teamFees).toEqual([]);
    expect(component.paymentErrorMessage).toBeNull();
  });

  it('renders a Pay Team Fee button only for unpaid fees', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [feeDoc('teams/team-real/feeBatches/batch-real/feeRecipients/recipient-real', 'recipient-real', {
        title: 'Spring registration',
        balanceDueCents: 12500,
        status: 'unpaid'
      })]
    });

    await component.ngOnInit();

    expect(template).toContain('*ngIf="!fee.isPaid"');
    expect(template).toContain('Pay Team Fee');
    expect(component.teamFees.filter((fee) => !fee.isPaid)).toHaveLength(1);
  });

  it('passes the selected fee recipient IDs to StripeService before redirecting', async () => {
    const selectedFee = {
      id: 'recipient-real',
      teamId: 'team-real',
      batchId: 'batch-real',
      recipientId: 'recipient-real',
      name: 'Spring registration',
      amount: 125,
      isPaid: false
    };
    component.teamFees = [selectedFee];

    expect(template).toContain('handlePayFee(fee)');

    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { href: 'https://allplays.test/team-fees' } }
    });

    await component.handlePayFee(selectedFee);

    expect(stripeService.initiateTeamFeeCheckout).toHaveBeenCalledWith('team-real', 'batch-real', 'recipient-real');
    expect(globalThis.window.location.href).toBe('https://checkout.stripe.com/team-fee-session');
    expect(component.pendingPaymentFeeId).toBeNull();
    expect(component.paymentErrorMessage).toBeNull();

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow
    });
  });

  it('scopes the initiating payment state to the selected unpaid fee', async () => {
    const selectedFee = { id: 'recipient-real', teamId: 'team-real', batchId: 'batch-real', recipientId: 'recipient-real', name: 'Registration', amount: 125, isPaid: false };
    const otherUnpaidFee = { id: 'recipient-other', teamId: 'team-real', batchId: 'batch-other', recipientId: 'recipient-other', name: 'Tournament', amount: 75, isPaid: false };
    let resolveCheckout: (checkoutUrl: string) => void = () => undefined;
    stripeService.initiateTeamFeeCheckout.mockReturnValue(new Promise((resolve) => {
      resolveCheckout = resolve;
    }));
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { href: 'https://allplays.test/team-fees' } }
    });

    expect(template).toContain('[disabled]="isPaymentPending()"');
    expect(template).toContain('*ngIf="isPaymentLoading(fee.id)"');

    const checkoutPromise = component.handlePayFee(selectedFee);

    expect(component.pendingPaymentFeeId).toBe(selectedFee.id);
    expect(component.isPaymentPending()).toBe(true);
    expect(component.isPaymentLoading(selectedFee.id)).toBe(true);
    expect(component.isPaymentLoading(otherUnpaidFee.id)).toBe(false);

    resolveCheckout('https://checkout.stripe.com/team-fee-session');
    await checkoutPromise;

    expect(component.pendingPaymentFeeId).toBeNull();
    expect(component.paymentErrorMessage).toBeNull();

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow
    });
  });

  it('ignores overlapping checkout attempts while another fee payment is pending', async () => {
    const selectedFee = { id: 'recipient-real', teamId: 'team-real', batchId: 'batch-real', recipientId: 'recipient-real', name: 'Registration', amount: 125, isPaid: false };
    const otherUnpaidFee = { id: 'recipient-other', teamId: 'team-real', batchId: 'batch-other', recipientId: 'recipient-other', name: 'Tournament', amount: 75, isPaid: false };
    let resolveCheckout: (checkoutUrl: string) => void = () => undefined;
    stripeService.initiateTeamFeeCheckout.mockReturnValue(new Promise((resolve) => {
      resolveCheckout = resolve;
    }));
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { href: 'https://allplays.test/team-fees' } }
    });

    const checkoutPromise = component.handlePayFee(selectedFee);
    await component.handlePayFee(otherUnpaidFee);

    expect(stripeService.initiateTeamFeeCheckout).toHaveBeenCalledTimes(1);
    expect(stripeService.initiateTeamFeeCheckout).toHaveBeenCalledWith('team-real', 'batch-real', 'recipient-real');
    expect(component.pendingPaymentFeeId).toBe(selectedFee.id);
    expect(component.isPaymentPending()).toBe(true);
    expect(component.isPaymentLoading(selectedFee.id)).toBe(true);
    expect(component.isPaymentLoading(otherUnpaidFee.id)).toBe(false);

    resolveCheckout('https://checkout.stripe.com/team-fee-session');
    await checkoutPromise;

    expect(component.pendingPaymentFeeId).toBeNull();
    expect(component.isPaymentPending()).toBe(false);

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow
    });
  });

  it('resets only the selected fee loading state and shows the existing error on checkout failure', async () => {
    const selectedFee = { id: 'recipient-real', teamId: 'team-real', batchId: 'batch-real', recipientId: 'recipient-real', name: 'Registration', amount: 125, isPaid: false };
    const otherUnpaidFee = { id: 'recipient-other', teamId: 'team-real', batchId: 'batch-other', recipientId: 'recipient-other', name: 'Tournament', amount: 75, isPaid: false };
    stripeService.initiateTeamFeeCheckout.mockRejectedValue(new Error('Stripe unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await component.handlePayFee(selectedFee);

    expect(consoleError).toHaveBeenCalledWith('Failed to initiate payment:', expect.any(Error));
    expect(stripeService.initiateTeamFeeCheckout).toHaveBeenCalledWith('team-real', 'batch-real', 'recipient-real');
    expect(component.pendingPaymentFeeId).toBeNull();
    expect(component.isPaymentPending()).toBe(false);
    expect(component.isPaymentLoading(selectedFee.id)).toBe(false);
    expect(component.isPaymentLoading(otherUnpaidFee.id)).toBe(false);
    expect(component.paymentErrorMessage).toBe('Failed to initiate payment. Please try again.');

    consoleError.mockRestore();
  });
});
