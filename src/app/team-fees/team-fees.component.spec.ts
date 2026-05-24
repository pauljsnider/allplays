import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', () => ({
  Component: () => () => undefined,
  OnInit: class {}
}));

vi.mock('../shared/services/stripe.service', () => ({
  StripeService: class {}
}));

const { TeamFeesComponent } = await import('./team-fees.component');

const template = readFileSync(resolve(process.cwd(), 'src/app/team-fees/team-fees.component.html'), 'utf8');

describe('TeamFeesComponent checkout flow', () => {
  let stripeService: { initiateTeamFeeCheckout: ReturnType<typeof vi.fn> };
  let component: InstanceType<typeof TeamFeesComponent>;

  beforeEach(() => {
    stripeService = {
      initiateTeamFeeCheckout: vi.fn().mockResolvedValue('https://checkout.stripe.com/team-fee-session')
    };
    component = new TeamFeesComponent(stripeService as never);
  });

  it('renders a Pay Team Fee button only for unpaid fees', () => {
    component.ngOnInit();

    expect(template).toContain('*ngIf="!fee.isPaid"');
    expect(template).toContain('Pay Team Fee');
    expect(component.teamFees).toEqual([
      expect.objectContaining({ id: 'fee1', isPaid: false }),
      expect.objectContaining({ id: 'fee2', isPaid: true }),
      expect.objectContaining({ id: 'fee3', isPaid: false })
    ]);
    expect(component.teamFees.filter((fee) => !fee.isPaid)).toHaveLength(2);
  });

  it('passes teamId, batchId, and recipientId to StripeService before redirecting', async () => {
    component.ngOnInit();
    const unpaidFee = component.teamFees.find((fee) => !fee.isPaid);

    expect(template).toContain('handlePayFee(fee)');
    expect(unpaidFee).toEqual(expect.objectContaining({
      teamId: 'teamA',
      batchId: 'batch1',
      recipientId: 'recipient1'
    }));

    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { href: 'https://allplays.test/team-fees' } }
    });

    await component.handlePayFee(unpaidFee!);

    expect(stripeService.initiateTeamFeeCheckout).toHaveBeenCalledWith('teamA', 'batch1', 'recipient1');
    expect(globalThis.window.location.href).toBe('https://checkout.stripe.com/team-fee-session');
    expect(component.pendingPaymentFeeId).toBeNull();
    expect(component.paymentErrorMessage).toBeNull();

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow
    });
  });

  it('scopes the initiating payment state to the selected unpaid fee', async () => {
    component.ngOnInit();
    const [selectedFee, otherUnpaidFee] = component.teamFees.filter((fee) => !fee.isPaid);
    let resolveCheckout: (checkoutUrl: string) => void = () => undefined;
    stripeService.initiateTeamFeeCheckout.mockReturnValue(new Promise((resolve) => {
      resolveCheckout = resolve;
    }));
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { href: 'https://allplays.test/team-fees' } }
    });

    expect(template).toContain('[disabled]="isPaymentLoading(fee.id)"');
    expect(template).toContain('*ngIf="isPaymentLoading(fee.id)"');

    const checkoutPromise = component.handlePayFee(selectedFee);

    expect(component.pendingPaymentFeeId).toBe(selectedFee.id);
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

  it('resets only the selected fee loading state and shows the existing error on checkout failure', async () => {
    component.ngOnInit();
    const [selectedFee, otherUnpaidFee] = component.teamFees.filter((fee) => !fee.isPaid);
    stripeService.initiateTeamFeeCheckout.mockRejectedValue(new Error('Stripe unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await component.handlePayFee(selectedFee);

    expect(consoleError).toHaveBeenCalledWith('Failed to initiate payment:', expect.any(Error));
    expect(stripeService.initiateTeamFeeCheckout).toHaveBeenCalledWith('teamA', 'batch1', 'recipient1');
    expect(component.pendingPaymentFeeId).toBeNull();
    expect(component.isPaymentLoading(selectedFee.id)).toBe(false);
    expect(component.isPaymentLoading(otherUnpaidFee.id)).toBe(false);
    expect(component.paymentErrorMessage).toBe('Failed to initiate payment. Please try again.');
    expect(component.teamFees.find((fee) => fee.id === 'fee2')).toEqual(expect.objectContaining({ isPaid: true }));

    consoleError.mockRestore();
  });
});
