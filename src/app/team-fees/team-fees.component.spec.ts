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
        status: 'unpaid',
        isPaid: false,
        collectionMode: '',
        canPayOnline: false,
        offlinePaymentInstructions: ''
      },
      {
        id: 'recipient-paid',
        teamId: 'team-real',
        batchId: 'batch-paid',
        recipientId: 'recipient-paid',
        name: 'Uniform fee',
        amount: 50,
        status: 'paid',
        isPaid: true,
        collectionMode: '',
        canPayOnline: false,
        offlinePaymentInstructions: ''
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
        status: 'unpaid',
        isPaid: false,
        collectionMode: '',
        canPayOnline: false,
        offlinePaymentInstructions: ''
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
        status: 'unpaid',
        isPaid: false,
        collectionMode: '',
        canPayOnline: false,
        offlinePaymentInstructions: ''
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

  it('gates the no-fees empty state behind completed fee loading', () => {
    expect(template).toContain('*ngIf="isLoadingFees; else feesReady"');
    expect(template).toContain('<ng-template #feesReady>');
    expect(template).toContain('*ngIf="teamFees.length > 0; else noFees"');
    expect(template.indexOf('else feesReady')).toBeLessThan(template.indexOf('else noFees'));
  });

  it('represents loading instead of the empty state while fees are still loading', () => {
    component.isLoadingFees = true;
    component.teamFees = [];

    expect(component.isLoadingFees).toBe(true);
    expect(component.teamFees).toHaveLength(0);
    expect(template).toContain('Loading team fees...');
    expect(template).toContain('*ngIf="isLoadingFees; else feesReady"');
  });

  it('renders a Pay Team Fee button only for unpaid online Stripe fees', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [feeDoc('teams/team-real/feeBatches/batch-real/feeRecipients/recipient-real', 'recipient-real', {
        title: 'Spring registration',
        balanceDueCents: 12500,
        status: 'unpaid',
        collectionMode: 'online_stripe'
      })]
    });

    await component.ngOnInit();

    expect(template).toContain('*ngIf="fee.canPayOnline"');
    expect(template).toContain('Pay Team Fee');
    expect(component.teamFees.filter((fee) => fee.canPayOnline)).toHaveLength(1);

    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { href: 'https://allplays.test/team-fees' } }
    });

    await component.handlePayFee(component.teamFees[0]);

    expect(stripeService.initiateTeamFeeCheckout).toHaveBeenCalledWith('team-real', 'batch-real', 'recipient-real');
    expect(globalThis.window.location.href).toBe('https://checkout.stripe.com/team-fee-session');

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow
    });
  });

  it('hides checkout for online Stripe fees without a positive remaining balance', async () => {
    const zeroAmountFee = feeDoc('teams/team-real/feeBatches/batch-zero/feeRecipients/recipient-zero', 'recipient-zero', {
      parentUserId: 'parent-123',
      title: 'Zero registration',
      amountCents: 0,
      status: 'unpaid',
      collectionMode: 'online_stripe'
    });
    const fullyPaidFee = feeDoc('teams/team-real/feeBatches/batch-paid/feeRecipients/recipient-paid', 'recipient-paid', {
      parentUserId: 'parent-123',
      title: 'Fully paid registration',
      amountCents: 12500,
      paidAmountCents: 12500,
      status: 'unpaid',
      collectionMode: 'online_stripe'
    });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [zeroAmountFee, fullyPaidFee] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });

    await component.ngOnInit();

    expect(component.teamFees.map((fee) => ({ id: fee.id, canPayOnline: fee.canPayOnline }))).toEqual([
      { id: 'recipient-zero', canPayOnline: false },
      { id: 'recipient-paid', canPayOnline: false }
    ]);
  });

  it('shows partially paid parent fees using the remaining balance used for checkout eligibility', async () => {
    const partiallyPaidFee = feeDoc('teams/team-real/feeBatches/batch-partial/feeRecipients/recipient-partial', 'recipient-partial', {
      parentUserId: 'parent-123',
      title: 'Partially paid registration',
      amountDueCents: 12500,
      paidAmountCents: 5000,
      status: 'unpaid',
      collectionMode: 'online_stripe'
    });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [partiallyPaidFee] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });

    await component.ngOnInit();

    expect(component.teamFees).toEqual([
      {
        id: 'recipient-partial',
        teamId: 'team-real',
        batchId: 'batch-partial',
        recipientId: 'recipient-partial',
        name: 'Partially paid registration',
        amount: 75,
        status: 'unpaid',
        isPaid: false,
        collectionMode: 'online_stripe',
        canPayOnline: true,
        offlinePaymentInstructions: ''
      }
    ]);
    expect(component.outstandingFees.map((fee) => ({ id: fee.id, amount: fee.amount, canPayOnline: fee.canPayOnline }))).toEqual([
      { id: 'recipient-partial', amount: 75, canPayOnline: true }
    ]);
  });

  it('maps unpaid offline manual fees without a pay action and keeps offline instructions', async () => {
    const offlineFee = feeDoc('teams/team-real/feeBatches/batch-real/feeRecipients/recipient-offline', 'recipient-offline', {
      parentUserId: 'parent-123',
      title: 'Cash registration',
      balanceDueCents: 6500,
      status: 'unpaid',
      collectionMode: 'offline_manual',
      offlinePaymentInstructions: 'Bring cash or check to practice.'
    });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [offlineFee] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });

    await component.ngOnInit();

    expect(template).toContain('offline-payment-instructions');
    expect(template).toContain('fee.offlinePaymentInstructions');
    expect(template).toContain('*ngIf="fee.canPayOnline"');
    expect(component.teamFees).toEqual([
      {
        id: 'recipient-offline',
        teamId: 'team-real',
        batchId: 'batch-real',
        recipientId: 'recipient-offline',
        name: 'Cash registration',
        amount: 65,
        status: 'unpaid',
        isPaid: false,
        collectionMode: 'offline_manual',
        canPayOnline: false,
        offlinePaymentInstructions: 'Bring cash or check to practice.'
      }
    ]);
  });

  it('does not allow paid or canceled fees to start checkout regardless of collection mode', async () => {
    const paidFee = feeDoc('teams/team-real/feeBatches/batch-paid/feeRecipients/recipient-paid', 'recipient-paid', {
      parentUserId: 'parent-123',
      title: 'Paid registration',
      balanceDueCents: 0,
      status: 'paid',
      collectionMode: 'online_stripe'
    });
    const canceledFee = feeDoc('teams/team-real/feeBatches/batch-canceled/feeRecipients/recipient-canceled', 'recipient-canceled', {
      parentUserId: 'parent-123',
      title: 'Canceled registration',
      balanceDueCents: 6500,
      status: 'canceled',
      collectionMode: 'online_stripe'
    });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [paidFee, canceledFee] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });

    await component.ngOnInit();

    expect(component.teamFees.map((fee) => ({ id: fee.id, status: fee.status, canPayOnline: fee.canPayOnline }))).toEqual([
      { id: 'recipient-paid', status: 'paid', canPayOnline: false },
      { id: 'recipient-canceled', status: 'canceled', canPayOnline: false }
    ]);
  });

  it('orders actionable unpaid fees before completed and canceled fees', async () => {
    const paidFee = feeDoc('teams/team-real/feeBatches/batch-paid/feeRecipients/recipient-paid', 'recipient-paid', {
      parentUserId: 'parent-123',
      title: 'Paid registration',
      balanceDueCents: 0,
      status: 'paid',
      collectionMode: 'online_stripe'
    });
    const canceledFee = feeDoc('teams/team-real/feeBatches/batch-canceled/feeRecipients/recipient-canceled', 'recipient-canceled', {
      parentUserId: 'parent-123',
      title: 'Canceled registration',
      balanceDueCents: 6500,
      status: 'canceled',
      collectionMode: 'online_stripe'
    });
    const offlineFee = feeDoc('teams/team-real/feeBatches/batch-offline/feeRecipients/recipient-offline', 'recipient-offline', {
      parentUserId: 'parent-123',
      title: 'Cash registration',
      balanceDueCents: 6500,
      status: 'unpaid',
      collectionMode: 'offline_manual'
    });
    const onlineFee = feeDoc('teams/team-real/feeBatches/batch-online/feeRecipients/recipient-online', 'recipient-online', {
      parentUserId: 'parent-123',
      title: 'Online registration',
      balanceDueCents: 12500,
      status: 'unpaid',
      collectionMode: 'online_stripe'
    });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [paidFee, canceledFee, offlineFee, onlineFee] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });

    await component.ngOnInit();

    expect(component.teamFees.map((fee) => ({ id: fee.id, status: fee.status, canPayOnline: fee.canPayOnline }))).toEqual([
      { id: 'recipient-online', status: 'unpaid', canPayOnline: true },
      { id: 'recipient-offline', status: 'unpaid', canPayOnline: false },
      { id: 'recipient-paid', status: 'paid', canPayOnline: false },
      { id: 'recipient-canceled', status: 'canceled', canPayOnline: false }
    ]);
    expect(component.outstandingFees.map((fee) => fee.id)).toEqual(['recipient-online', 'recipient-offline']);
    expect(component.feeHistory.map((fee) => fee.id)).toEqual(['recipient-paid', 'recipient-canceled']);
    expect(template).toContain('*ngFor="let fee of outstandingFees"');
    expect(template).toContain('*ngFor="let fee of feeHistory"');
    expect(template).toContain('paymentHistoryOpen');
    expect(template).toContain('togglePaymentHistory()');
    expect(template).toContain('No outstanding team fees');
  });

  it('keeps paid and canceled fees accessible when there are no outstanding balances', async () => {
    const paidFee = feeDoc('teams/team-real/feeBatches/batch-paid/feeRecipients/recipient-paid', 'recipient-paid', {
      parentUserId: 'parent-123',
      title: 'Paid registration',
      balanceDueCents: 0,
      status: 'paid',
      collectionMode: 'online_stripe'
    });
    const canceledFee = feeDoc('teams/team-real/feeBatches/batch-canceled/feeRecipients/recipient-canceled', 'recipient-canceled', {
      parentUserId: 'parent-123',
      title: 'Canceled registration',
      balanceDueCents: 6500,
      status: 'canceled',
      collectionMode: 'online_stripe'
    });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [paidFee, canceledFee] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });

    await component.ngOnInit();

    expect(component.outstandingFees).toEqual([]);
    expect(component.feeHistory.map((fee) => ({ id: fee.id, status: fee.status, canPayOnline: fee.canPayOnline }))).toEqual([
      { id: 'recipient-paid', status: 'paid', canPayOnline: false },
      { id: 'recipient-canceled', status: 'canceled', canPayOnline: false }
    ]);
    expect(component.paymentHistoryOpen).toBe(false);

    component.togglePaymentHistory();

    expect(component.paymentHistoryOpen).toBe(true);
  });

  it('treats zero-balance unpaid records as paid history entries', async () => {
    const zeroRemainingBalanceFee = feeDoc('teams/team-real/feeBatches/batch-zero-balance/feeRecipients/recipient-zero-balance', 'recipient-zero-balance', {
      parentUserId: 'parent-123',
      title: 'Zero remaining balance',
      amountCents: 12500,
      remainingBalanceCents: 0,
      status: 'unpaid',
      collectionMode: 'online_stripe'
    });
    const fullyPaidFee = feeDoc('teams/team-real/feeBatches/batch-fully-paid/feeRecipients/recipient-fully-paid', 'recipient-fully-paid', {
      parentUserId: 'parent-123',
      title: 'Fully paid by amount',
      amountCents: 12500,
      paidAmountCents: 12500,
      status: 'unpaid',
      collectionMode: 'online_stripe'
    });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [zeroRemainingBalanceFee, fullyPaidFee] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });

    await component.ngOnInit();

    expect(component.outstandingFees).toEqual([]);
    expect(component.feeHistory.map((fee) => ({ id: fee.id, status: fee.status, isPaid: fee.isPaid, canPayOnline: fee.canPayOnline }))).toEqual([
      { id: 'recipient-zero-balance', status: 'paid', isPaid: true, canPayOnline: false },
      { id: 'recipient-fully-paid', status: 'paid', isPaid: true, canPayOnline: false }
    ]);
  });

  it('passes the selected fee recipient IDs to StripeService before redirecting', async () => {
    const selectedFee = {
      id: 'recipient-real',
      teamId: 'team-real',
      batchId: 'batch-real',
      recipientId: 'recipient-real',
      name: 'Spring registration',
      amount: 125,
      status: 'unpaid',
      isPaid: false,
      collectionMode: 'online_stripe',
      canPayOnline: true,
      offlinePaymentInstructions: ''
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
    const selectedFee = { id: 'recipient-real', teamId: 'team-real', batchId: 'batch-real', recipientId: 'recipient-real', name: 'Registration', amount: 125, status: 'unpaid', isPaid: false, collectionMode: 'online_stripe', canPayOnline: true, offlinePaymentInstructions: '' };
    const otherUnpaidFee = { id: 'recipient-other', teamId: 'team-real', batchId: 'batch-other', recipientId: 'recipient-other', name: 'Tournament', amount: 75, status: 'unpaid', isPaid: false, collectionMode: 'online_stripe', canPayOnline: true, offlinePaymentInstructions: '' };
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
    const selectedFee = { id: 'recipient-real', teamId: 'team-real', batchId: 'batch-real', recipientId: 'recipient-real', name: 'Registration', amount: 125, status: 'unpaid', isPaid: false, collectionMode: 'online_stripe', canPayOnline: true, offlinePaymentInstructions: '' };
    const otherUnpaidFee = { id: 'recipient-other', teamId: 'team-real', batchId: 'batch-other', recipientId: 'recipient-other', name: 'Tournament', amount: 75, status: 'unpaid', isPaid: false, collectionMode: 'online_stripe', canPayOnline: true, offlinePaymentInstructions: '' };
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
    const selectedFee = { id: 'recipient-real', teamId: 'team-real', batchId: 'batch-real', recipientId: 'recipient-real', name: 'Registration', amount: 125, status: 'unpaid', isPaid: false, collectionMode: 'online_stripe', canPayOnline: true, offlinePaymentInstructions: '' };
    const otherUnpaidFee = { id: 'recipient-other', teamId: 'team-real', batchId: 'batch-other', recipientId: 'recipient-other', name: 'Tournament', amount: 75, status: 'unpaid', isPaid: false, collectionMode: 'online_stripe', canPayOnline: true, offlinePaymentInstructions: '' };
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
